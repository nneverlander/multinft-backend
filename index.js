require('@google-cloud/debug-agent').start();
require("dotenv").config();
const path = require('path');

const express = require("express");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const firebase = require("firebase-admin");
firebase.initializeApp();
const db = firebase.firestore();
let rootRefSuffix = process.env.rootRefSuffix;

const HDWalletProvider = require("truffle-hdwallet-provider");
const web3 = require("web3");
const truffleContract = require("truffle-contract");
const multiNFTJson = require("./MultiNFT.json");
const MultiNFT = truffleContract(multiNFTJson);
let multiNFTInstance;
let web3js;
let web3Provider;

let fromAddress = process.env.FROM_ADDRESS;
let provider = process.env.web3Provider;
let contractAddress = process.env.multiNFTContractAddress;
let privKey = process.env.privKey;
let gasLimit = process.env.gasLimit;
let gasPrice = process.env.gasPriceWei;
let txnTimeout = process.env.txnTimeout || 60; // in seconds

// lowest nonce holds the nonce of the last confirmed txn for this address
let programNonce = 0;
// indicates the number of slots full
let slotsUsed = 0;
let maxSlots = 50; //based on max num of txns that eth clients queue per address (64)
let highestNonceUsed = 0;

let activeTxns = {};
let numActive = 0;

const port = process.env.PORT || 3000;

init();

async function init() {
    let unsub;
    let configVersion;
    db.collection("config").doc("current").onSnapshot(currentConfig => {
        if (unsub) {
            // stop listening to old version changes
            unsub();
            console.log("Stopped listening to old doc");
        }
        configVersion = currentConfig.data().version;
        console.log("Current config version changed. Reading new data");
        unsub = readNewConfig(configVersion);
    }, err => {
        console.error(`Encountered error: ${err} while listening to current config version changes`);
    });

    setInterval(() => {
        cleanUp();
    }, 60 * 1000);
}

async function initContract() {
    if (!privKey) {
        console.log("Contract cannot be initialized since privKey is null");
        return;
    }
    if (!provider) {
        console.log("Contract cannot be initialized since provider is null");
        return;
    }
    // logging provider string length as the actual string is confidential 
    console.log("Initiating contract at address " + contractAddress + " with from address: " + fromAddress + " on network " + rootRefSuffix + " and provider with string length " + provider.length);
    web3Provider = new HDWalletProvider(privKey, provider);
    // need to stop engine since unnecessary polling is not required
    // todo: also truffle contract handler listens for 25 txn confirmations before resolving, need to change that 
    web3Provider.engine.stop();
    web3js = new web3(web3Provider, undefined, { transactionConfirmationBlocks: 1 });
    MultiNFT.setProvider(web3Provider);
    MultiNFT.numberFormat = "String";

    multiNFTInstance = await MultiNFT.at(contractAddress);
    programNonce = await getAccountNonce();
    console.log("Contract initialized");
}

function readNewConfig(version) {
    let unsub = db.collection("config").doc(version).onSnapshot(async config => {
        console.log("Config changed");
        let configData = config.data();
        // root suffix check must come before from address check since address info is read from a collection with this suffix
        if (!rootRefSuffix || rootRefSuffix != configData.rootRefSuffix) {
            rootRefSuffix = configData.rootRefSuffix;
        }
        if (!contractAddress || contractAddress != configData.multiNFTContractAddress) {
            contractAddress = configData.multiNFTContractAddress;
        }
        if (!gasLimit || gasLimit != configData.gasLimit) {
            gasLimit = configData.gasLimit;
        }
        if (!gasPrice || gasPrice != configData.gasPriceWei) {
            gasPrice = configData.gasPriceWei;
        }
        if (!txnTimeout || txnTimeout != configData.txnTimeout) {
            txnTimeout = configData.txnTimeout;
        }
        if (!fromAddress || fromAddress != configData.fromAddress) {
            await readAddressData();
        }
        // provider check should always be the last we check for since it involves initializing contract
        if (!provider || provider != configData.web3Provider) {
            provider = configData.web3Provider;
            initContract();
        }
    }, err => {
        console.error(`Encountered error: ${err} while listening to config changes`);
    });
    return unsub;
}

async function readAddressData() {
    let account = await db.collection("accounts" + rootRefSuffix).orderBy("lastUpdatedAt", "asc").limit(1).get();
    fromAddress = account.docs[0].id;
    console.log("Using address", fromAddress);
    // update last used to now
    await db.collection("accounts" + rootRefSuffix).doc(fromAddress).set({lastUpdatedAt : firebase.firestore.FieldValue.serverTimestamp()}, {merge: true});
    privKey = account.docs[0].data().privKey;
    initContract();
}

async function cleanUp() {
    let accountNonce = await getAccountNonce();
    console.log("Cleaning up. Program nonce " + programNonce + " is being reset to account nonce " + accountNonce);
    programNonce = accountNonce;

    let txnProps = getTxnProps();
    txnProps.nonce = programNonce;
    multiNFTInstance.sendTransaction(txnProps).then(result => {
        console.log("Clean up dummy succeeded with nonce " + programNonce);
        if (programNonce > highestNonceUsed) {
            highestNonceUsed = programNonce;
        }
        programNonce++;
    });
}

function getTxnId(txn) {
    let txnId = txn + Math.random();
    activeTxns[txnId] = true;
    numActive++;
    return txnId;
}

function sendDummyTxn(nonce, txnId) {
    // send a dummy txn to fill up the freed slot so that any txns with higher nonces can proceed
    // this condition means there is a "gap" in the array
    // without this gap being filled, txns with higher nonces will not complete
    let txnProps = getTxnProps();
    txnProps.nonce = nonce;

    console.log("Sending dummy txn to have nonce gap filled with nonce " + nonce + " when program nonce is " + programNonce);

    multiNFTInstance.sendTransaction(txnProps).then(result => {
        console.log("Dummy txn with nonce " + nonce + " succeeded when program nonce is " + programNonce);
        updateNonce("dummy");
    }).catch(async err => {
        //reset program nonce to account nonce
        console.error("Dummy txn with nonce " + nonce + " failed when program nonce is " + programNonce + " with error ", err.toString());
        let accountNonce = await getAccountNonce();
        console.log("Program nonce " + programNonce + " is being reset to account nonce " + accountNonce);
        programNonce = accountNonce;

        if (activeTxns[txnId] == true) {
            slotsUsed--;
            delete activeTxns[txnId];
            numActive--;
            console.log("Txn id " + txnId + " is cleared");
        } else {
            console.log(txnId + " is already clear");
        }
        console.log("num active " + numActive + " slots used " + slotsUsed);
    });
}

function prepareNonce(txn) {
    let nonce = -1;
    if (slotsUsed > maxSlots) {
        console.log("All slots for address " + fromAddress + " are currently full. Cannot execute " + txn + " at this moment. Try again later");
        return nonce;
    } else {
        nonce = programNonce + slotsUsed;
        slotsUsed++;
    }
    console.log("For " + txn + ", using nonce " + nonce + ", from address: " + fromAddress + ". Slots used so far: " + slotsUsed);
    if (nonce > highestNonceUsed) {
        highestNonceUsed = nonce;
        console.log("=============================================================Highest Nonce============================================================", highestNonceUsed);
    }
    return nonce;
}

function updateNonce(txnId) {
    if (activeTxns[txnId] == true) {
        programNonce++;
        slotsUsed--;
        delete activeTxns[txnId];
        numActive--;
        console.log("Txn id " + txnId + " is cleared");
    } else {
        console.log("Txn " + txnId + " is already clear");
    }
    console.log("num active " + numActive + " slots used " + slotsUsed);
}

function handleTxnErr(err, txnId, nonce) {
    if (err.receipt && err.receipt.transactionHash) {
        console.log("Error has txn hash so not sending dummy txn");
        logResult(err);
        updateNonce(txnId);
    } else {
        // since this txn failed, see if this slot needs to be filled
        // need to call this only when nonce is not mined
        sendDummyTxn(nonce, txnId);
    }
}

async function getAccountNonce() {
    let accountNonce = 0;
    try {
        accountNonce = await web3js.eth.getTransactionCount(fromAddress);
    } catch (error) {
        console.error("Error occured while getting account nonce", error.toString());
    }
    return accountNonce;
}

// this is for stackdriver ax
function logResult(result) {
    let logObject = {
        tx: result.receipt.transactionHash,
        gasUsed: result.receipt.gasUsed,
        gasPrice: gasPrice,
        gasLimit: gasLimit,
        status: result.receipt.status
    }
    console.log(JSON.stringify(logObject));
}

function updateActivity(activityId, receipt) {
    let data = {
        tx: receipt.transactionHash,
        status: receipt.status
    }
    db.collection("activity" + rootRefSuffix).doc(activityId).set(data, { merge: true }).then(res => {
        console.log("Updated activity " + activityId);
    }).catch(err => {
        console.error("Activity " + activityId + " not updated", err.toString());
    });
}

function getTxnProps() {
    let txnProps = {
        from: fromAddress,
        gas: gasLimit,
        gasPrice: gasPrice
    }
    return txnProps;
}

function setTxnTimeout(txnId, res) {
    setTimeout(async () => {
        console.log("Time out occured for txn: " + txnId);
        if (activeTxns[txnId] == true) {
            res.status(500).send("Cannot execute txn at this moment");
        }
        updateNonce(txnId);
    }, txnTimeout * 1000);
}

function prepareTxn(txnName, res) {
    let nonce = prepareNonce(txnName);
    if (nonce == -1) {
        return null;
    }
    let txnId = getTxnId(txnName);
    let txnProps = getTxnProps();
    txnProps.nonce = nonce;
    txnProps.txnId = txnId;
    setTxnTimeout(txnId, res);
    return txnProps;
}

app.get("/", async function(req, res) {
    res.sendFile(path.join(__dirname, 'public/html/index.html'));
});

app.get("/activity", async function(req, res) {
    res.sendFile(path.join(__dirname, 'public/html/activity.html'));
});

app.get("/slotsused", async function(req, res) {
    res.send("Slots used: " + slotsUsed);
});

app.post("/resetslots", async function(req, res) {
    let slots = slotsUsed;
    slotsUsed = 0;
    res.send("Slots " + slots + " reset to 0");
});

app.get("/nonce", async function(req, res) {
    let accountNonce = await getAccountNonce();
    res.send("Program nonce: " + programNonce + ", account nonce: " + accountNonce);
});

app.get("/highestnonce", async function(req, res) {
    res.send("Highest nonce used: " + highestNonceUsed);
});

app.get("/geturi", async function(req, res) {
    let tokenUri = await multiNFTInstance.tokenURI(req.query.tokenId);
    res.send(tokenUri);
});

app.get("/nftexists", async function(req, res) {
    let nameExists = await multiNFTInstance.nameExists(req.query.name);
    let symbolExists = await multiNFTInstance.symbolExists(req.query.symbol);
    let resp = {
        nameExists: nameExists,
        symbolExists: symbolExists
    }
    res.send(resp);
});

app.post("/resetnonce", async function(req, res) {
    let accountNonce = await getAccountNonce();
    let progNonce = programNonce;
    programNonce = accountNonce;
    res.status(200).send("Program nonce " + progNonce + " reset to account nonce " + accountNonce);
});

app.post("/addactivity", async function(req, res) {
    db.collection("activity" + rootRefSuffix).add(req.body).then(ref => {
        console.log("Added activity " + req.body.action + " for owner " + req.body.owner + " to firestore with id: ", ref.id);
        res.status(200).send(ref.id);
    }).catch(err => {
        console.error("Activity " + req.body.action + " from " + req.body.owner + " not added", err.toString());
        res.status(500).send("Activity not added: " + err.toString());
    });
});

app.post("/create", async (req, res) => {
    try {
        let nameExists = await multiNFTInstance.nameExists(req.body.name);
        if (nameExists) {
            res.send("Name already exists");
            return;
        }
        let symbolExists = await multiNFTInstance.symbolExists(req.body.symbol);
        if (symbolExists) {
            res.send("Symbol already exists");
            return;
        }

        let txnProps = prepareTxn("webCreateType", res);
        if (!txnProps) {
            console.error("Cannot execute txn at this moment");
            res.status(500).send("Cannot execute txn at this moment");
            return;
        }
        let nonce = txnProps.nonce;
        let txnId = txnProps.txnId;

        multiNFTInstance.webCreateType(req.body.name, req.body.symbol, req.body.uri, req.body.owner, txnProps).then(result => {

            updateNonce(txnId);

            // add result to firebase
            if (result && result.receipt && result.logs) {
                logResult(result);
                let createLog;
                for (var i = 0; i < result.logs.length; i++) {
                    let log = result.logs[i];
                    if (log.event == "WebCreateType") {
                        createLog = log;
                        break;
                    }
                }
                let data = {
                    name: req.body.name,
                    symbol: req.body.symbol,
                    type: createLog.args.tokenType,
                    uri: req.body.uri,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash
                }
                db.collection("types" + rootRefSuffix).doc(req.body.name).set(data).then(res => {
                    console.log("Added type " + req.body.name + " to firestore");
                });
                updateActivity(req.body.activityId, result.receipt);
            } else {
                console.log("Type " + req.body.name + " not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.error("Create type txn with nonce " + nonce + " failed", err.toString());
            updateActivity(req.body.activityId, { transactionHash: null, status: false });
            handleTxnErr(err, txnId, nonce);
            res.status(500).send("Create type txn with nonce " + nonce + " may have failed: " + err.toString());
        });
    } catch (err) {
        console.error("Create type " + req.body.name + " failed", err.toString());
    }
});

app.post("/mint", async (req, res) => {
    try {
        let txnProps = prepareTxn("webCreateType", res);
        if (!txnProps) {
            console.error("Cannot execute txn at this moment");
            res.status(500).send("Cannot execute txn at this moment");
            return;
        }
        let nonce = txnProps.nonce;
        let txnId = txnProps.txnId;

        multiNFTInstance.webMint(req.body.name, req.body.uri, req.body.count, req.body.owner, txnProps).then(result => {

            updateNonce(txnId);

            // add result to firebase
            if (result && result.receipt && result.logs) {
                logResult(result);
                let mintLog;
                for (var i = 0; i < result.logs.length; i++) {
                    let log = result.logs[i];
                    if (log.event == "WebMint") {
                        mintLog = log;
                        break;
                    }
                }
                let data = {
                    name: req.body.name,
                    type: mintLog.args.tokenType,
                    tokenIds: mintLog.args.tokenIds,
                    count: req.body.count,
                    uri: req.body.uri,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash
                }
                db.collection("mints" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added " + req.body.count + " mints of type " + req.body.name + " to firestore with id: ", ref.id);
                });
                updateActivity(req.body.activityId, result.receipt);

                // add tokens to its own collection
                let tokenIds = mintLog.args.tokenIds;
                for (var i = 0; i < tokenIds.length; i++) {
                    let tokenData = {
                        name: req.body.name,
                        type: mintLog.args.tokenType,
                        uri: req.body.uri,
                        owner: req.body.owner,
                        tokenId: tokenIds[i]
                    }
                    let tokenId = tokenIds[i];
                    db.collection("tokens" + rootRefSuffix).doc(tokenId).set(tokenData).then(res => {
                        console.log("Added " + tokenId + " to firestore");
                    }).catch(err => {
                        console.error("Failed adding token " + tokenId + " to firstore", err.toString());
                    });
                }
            } else {
                console.error("Mints of type " + req.body.name + " not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.error("Mint txn with nonce " + nonce + " failed", err.toString());
            updateActivity(req.body.activityId, { transactionHash: null, status: false });
            handleTxnErr(err, txnId, nonce);
            res.status(500).send("Mint with nonce " + nonce + " may have failed: " + err.toString());
        });
    } catch (err) {
        console.error("Minting of " + req.body.name + " failed", err.toString());
    }
});

app.post("/transfer", async (req, res) => {
    try {
        // first check if the token is a type. If it is reject as types can only be claimed first
        let tokenType = await db.collection("types" + rootRefSuffix).where("type", "==", req.body.tokenId).get();
        if (tokenType.docs.length > 0) {
            console.error("Cannot transfer type " + req.body.tokenId  + ", it has to be claimed");
            updateActivity(req.body.activityId, { transactionHash: null, status: false });
            res.status(500).send("Cannot transfer type " + req.body.tokenId  + ", it has to be claimed");
            return;
        }

        let txnProps = prepareTxn("webCreateType", res);
        if (!txnProps) {
            console.error("Cannot execute txn at this moment");
            res.status(500).send("Cannot execute txn at this moment");
            return;
        }
        let nonce = txnProps.nonce;
        let txnId = txnProps.txnId;

        multiNFTInstance.webTransfer(req.body.to, req.body.tokenId, req.body.owner, txnProps).then(result => {

            updateNonce(txnId);

            // add result to firebase
            if (result && result.receipt) {
                logResult(result);
                let data = {
                    tokenId: req.body.tokenId,
                    to: req.body.to,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash
                }
                db.collection("transfers" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added token transfer to firestore with id: ", ref.id);
                });
                updateActivity(req.body.activityId, result.receipt);

                // remove token from firestore
                db.collection("tokens" + rootRefSuffix).doc(req.body.tokenId).delete().then(res => {
                    console.log("Token " + req.body.tokenId + " successfully deleted!");
                }).catch(function(error) {
                    console.error("Error deleting token " + req.body.tokenId, error);
                });
            } else {
                console.log("Token transfer not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.error("Token transfer txn with nonce " + nonce + " failed", err.toString());
            updateActivity(req.body.activityId, { transactionHash: null, status: false });
            handleTxnErr(err, txnId, nonce);
            res.status(500).send("Token transfer txn with nonce " + nonce + " may have failed: " + err.toString());
        });
    } catch (err) {
        console.error("Transfer failed", err.toString());
    }
});

app.post("/claim", async (req, res) => {
    try {
        let txnProps = prepareTxn("webCreateType", res);
        if (!txnProps) {
            console.error("Cannot execute txn at this moment");
            res.status(500).send("Cannot execute txn at this moment");
            return;
        }
        let nonce = txnProps.nonce;
        let txnId = txnProps.txnId;

        multiNFTInstance.webClaimType(req.body.name, req.body.oldOwner, req.body.newOwner, txnProps).then(result => {

            updateNonce(txnId);

            // add result to firebase
            if (result && result.receipt && result.logs) {
                logResult(result);
                let claimLog;
                for (var i = 0; i < result.logs.length; i++) {
                    let log = result.logs[i];
                    if (log.event == "WebClaimType") {
                        claimLog = log;
                        break;
                    }
                }
                let data = {
                    name: req.body.name,
                    type: claimLog.args.tokenType,
                    newOwner: req.body.newOwner,
                    oldOwner: req.body.oldOwner,
                    txn: result.receipt.transactionHash
                }
                db.collection("claims" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added claim to firestore with id: ", ref.id);
                });
                updateActivity(req.body.activityId, result.receipt);

                // remove type from firestore
                db.collection("types" + rootRefSuffix).doc(req.body.name).delete().then(res => {
                    console.log("Type " + req.body.name + " successfully deleted!");
                }).catch(function(error) {
                    console.error("Error deleting type " + req.body.name, error);
                });
            } else {
                console.log("Claim not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.error("Claim txn with nonce " + nonce + " failed", err);
            updateActivity(req.body.activityId, { transactionHash: null, status: false });
            handleTxnErr(err, txnId, nonce);
            res.status(500).send("Claim txn with nonce " + nonce + " may have failed: " + err.toString());
        });
    } catch (err) {
        console.error('Claim failed', err.toString());
    }
});

app.post("/seturi", async (req, res) => {
    try {

        let txnProps = prepareTxn("webSetUri", res);
        if (!txnProps) {
            console.error("Cannot execute txn at this moment");
            res.status(500).send("Cannot execute txn at this moment");
        }
        let nonce = txnProps.nonce;
        let txnId = txnProps.txnId;

        multiNFTInstance.webSetTokenURI(req.body.tokenId, req.body.uri, req.body.owner, txnProps).then(result => {

            updateNonce(txnId);

            if (result && result.receipt) {
                logResult(result);
                let data = {
                    tokenId: req.body.tokenId,
                    uri: req.body.uri,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash,
                    lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
                db.collection("uriChanges" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added token uri change to firestore with id: ", ref.id);
                });
                updateActivity(req.body.activityId, result.receipt);

                //update token or type
                if (req.body.type == "___token___") {
                    db.collection("tokens" + rootRefSuffix).doc(req.body.tokenId).set({ uri: req.body.uri }, { merge: true }).then(res => {
                        console.log("Token uri changed to " + req.body.uri + " for token " + req.body.tokenId);
                    }).catch(err => {
                        console.error("Token uri change failed for token " + req.body.tokenId);
                    });
                } else {
                    db.collection("types" + rootRefSuffix).doc(req.body.type).set({ uri: req.body.uri }, { merge: true }).then(res => {
                        console.log("Type uri changed to " + req.body.uri + " for type " + req.body.type);
                    }).catch(err => {
                        console.error("Type uri change failed for type " + req.body.type);
                    });
                }

            } else {
                console.log("Token uri change not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.error("Token uri change txn with nonce " + nonce + " failed", err.toString());
            updateActivity(req.body.activityId, { transactionHash: null, status: false });
            handleTxnErr(err, txnId, nonce);
            res.status(500).send("Token uri change txn with nonce " + nonce + " may have failed: " + err.toString());
        });
    } catch (err) {
        console.error('Token uri change failed', err.toString());
    }
});

app.listen(port, () => console.log("Listening on port " + port));