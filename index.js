require('@google-cloud/debug-agent').start();
require("dotenv").config();

const express = require("express");
const app = express();
app.use(express.json());

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

// value can be 0 or 1 indicating whether the slot is free or not. 0 is free
let slots = new Int8Array(50);
// lowest nonce holds the nonce of the last confirmed txn for this address
let programNonce = 0;
// indicates the number of slots full
let slotsUsed = 0;
let lastUpdatedFireStoreNonce = 0;

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
        console.log(`Encountered error: ${err} while listening to current config version changes`);
    });
    // update firestore nonce every 10 seconds
    setInterval(updateFirestoreNonce, 10*1000);
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
    console.log("Initiating contract with from address: " + fromAddress + " and provider with string length " + provider.length);
    web3Provider = new HDWalletProvider(privKey, provider);
    // need to stop engine since unnecessary polling is not required
    // todo: also truffle contract handler listens for 25 txn confirmations before resolving, need to change that 
    web3Provider.engine.stop();
    web3js = new web3(web3Provider, undefined, {transactionConfirmationBlocks: 1});
    MultiNFT.setProvider(web3Provider);
    MultiNFT.numberFormat = "String";
    multiNFTInstance = await MultiNFT.at(contractAddress);
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
        if (!fromAddress || fromAddress != configData.fromAddress) {
            console.log("Account changed to " + configData.fromAddress);
            fromAddress = configData.fromAddress;
            await readAddressData();
        }
        // provider check should always be the last we check for since it involves initializing contract
        if (!provider || provider != configData.web3Provider) {
            provider = configData.web3Provider;
            initContract();
        } 
    }, err => {
        console.log(`Encountered error: ${err} while listening to config changes`);
    });
    return unsub;
}

async function readAddressData() {
    let account = await db.collection("accounts" + rootRefSuffix).doc(fromAddress).get();
    programNonce = account.data().nonce;
    privKey = account.data().privKey;
    initContract();
}

function getSlot() {
    for (let i = 0; i < slots.length; i++) {
        if (!slots[i]) {
            return i; 
        }
    }
    // this should never happen
    return slots.length + 1;
}

function sendDummyTxn(slot, nonce) {
    // send a dummy txn to fill up the freed slot so that any txns with higher nonces can proceed
    // this condition means there is a "gap" in the array
    // without this gap being filled, txns with higher nonces will not complete
    console.log("Sending dummy txn to have nonce gap filled with nonce " + nonce + " in slot " + slot + " when program nonce is " + programNonce);
    multiNFTInstance.sendTransaction({from: fromAddress, nonce: nonce, value: 0}).then(result => {
        console.log("Dummy txn with nonce " + nonce + " succeeded when program nonce is " + programNonce);
        programNonce++;
        slots[slot] = 0;
        slotsUsed--;
    }).catch(err => {
        //reset program nonce to account nonce
        console.log("Dummy txn with nonce " + nonce + " failed when program nonce is " + programNonce + " with error ", err.toString());
        slots[slot] = 0;
        slotsUsed--;
        web3js.eth.getTransactionCount(fromAddress).then(count => {
            console.log("Program nonce " + programNonce + " is being reset to account nonce " + count);
            programNonce = count;
        }).catch(error => {
            console.log("Error while getting account nonce ", error.toString());
        });
    });
}

function prepareNonceSlot(txn) {
    let nonce;
    let slot;
    if (slotsUsed > slots.length) {
        console.log("All slots for address " + fromAddress + " are currently full. Cannot execute " + txn + " at this moment. Try again later");
        return;
    } else {
        slot = getSlot();
        nonce = programNonce + slot;
        slots[slot] = 1;
        slotsUsed++;
    }
    console.log("For " + txn + ", using nonce " + nonce + ", from address: " + fromAddress + ", slot " + slot + ". Slots used so far: " + slotsUsed);
    return [nonce, slot];
}

// currently called periodically
function updateFirestoreNonce() {
    if (lastUpdatedFireStoreNonce == programNonce) {
        // no change
        return;
    }
    lastUpdatedFireStoreNonce = programNonce;
    let newData = {
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        nonce: programNonce
    }
    db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(newData, {merge: true}).then(result => {
        console.log("Updated firebase doc " + fromAddress + " with data: " + JSON.stringify(newData));
    }).catch(err => {
        console.log("Updating firebase failed ", err.toString());
    })
}

function updateNonceSlot(slot, txn) {
    programNonce++;
    slots[slot] = 0;
    slotsUsed--;
}

function handleTxnErr(err, txn, slot, nonce) {
    if (err.receipt && err.receipt.transactionHash) {
        console.log("Error has txn hash so not sending dummy txn");
        logResult(err);
        programNonce++;
        slots[slot] = 0;
        slotsUsed--;
    }
    else {
        // since this txn failed, see if this slot needs to be filled
        // need to call this only when nonce is not mined
        sendDummyTxn(slot, nonce);
    }
}

// this is for stackdriver ax
function logResult(result) {
    let logObject = {
        tx: result.receipt.transactionHash,
        gasUsed: result.receipt.gasUsed,
        gasPrice: gasPrice,
        gasLimit: gasLimit  
    }
    console.log(JSON.stringify(logObject));
}

app.get("/", async function(req, res) {
    res.send("Hello");
});

app.get("/slotsused", async function(req, res) {
    res.send("Slots used: " + slotsUsed);
});

app.get("/nonce", async function(req, res) {
    web3js.eth.getTransactionCount(fromAddress).then(count => {
        res.send("Program nonce: " + programNonce + ", account nonce: " + count);
    }).catch(error => {
        console.log("Error while getting nonce ", error.toString());
        res.status(500).send("Error occured while getting nonce");
    });
});

app.post("/resetnonce", async function(req, res) {
    web3js.eth.getTransactionCount(fromAddress).then(count => {
        console.log("Resetting program nonce " + programNonce + " to account nonce " + count);
        programNonce = count;
        // update firebase
        let updateData = {
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            nonce: programNonce
        };
        db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(updateData, {merge: true}).then(nonceUpdate => {
            console.log("Updated firebase doc " + fromAddress + " during reset nonce with data: " + JSON.stringify(updateData));
            res.status(200).send("Nonce reset to " + programNonce);
        }).catch(err => {
            console.log("Updating firebase during reset nonce failed ", err.toString());
            res.status(500).send("Nonce reset failed");
        })
    });
});

app.post("/create", async function(req, res) {
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

        let nonceSlot = prepareNonceSlot("webCreateType");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        let txnProps = {
            from: fromAddress,
            nonce: nonce,
            gas: gasLimit,
            gasPrice: gasPrice
        }

        multiNFTInstance.webCreateType(req.body.name, req.body.symbol, req.body.uri, req.body.owner, txnProps).then(result => {

            updateNonceSlot(slot, "webCreateType");

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
                db.collection("types" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added type " + req.body.name + " to firestore with id: ", ref.id);
                });
            } else {
                console.log("Type " + req.body.name + " not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Create type txn with nonce " + nonce + " failed", err.toString());
            handleTxnErr(err, "webCreateType", slot, nonce);
            res.status(500).send("Create type txn may have failed");
        });
    } catch (err) {
        console.log("Create type " + req.body.name + " failed", err.toString());
    }
});

app.post("/mint", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webMint");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        let txnProps = {
            from: fromAddress,
            nonce: nonce,
            gas: gasLimit,
            gasPrice: gasPrice
        }

        multiNFTInstance.webMint(req.body.name, req.body.uri, req.body.count, req.body.owner, txnProps).then(result => {

            updateNonceSlot(slot, "webMint");

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
            } else {
                console.log("Mints of type " + req.body.name + " not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Mint txn with nonce " + nonce + " failed", err.toString());
            handleTxnErr(err, "webMint", slot, nonce);
            res.status(500).send("Mint may have failed");
        });
    } catch (err) {
        console.log("Minting of " + req.body.name + " failed", err.toString());
    }
});

app.post("/transfer", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webTransfer");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        let txnProps = {
            from: fromAddress,
            nonce: nonce,
            gas: gasLimit,
            gasPrice: gasPrice
        }

        multiNFTInstance.webTransfer(req.body.to, req.body.tokenId, req.body.owner, txnProps).then(result => {

            updateNonceSlot(slot, "webTransfer");

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
            } else {
                console.log("Token transfer not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Token transfer txn with nonce " + nonce + " failed", err.toString());
            handleTxnErr(err, "webTransfer", slot, nonce);
            res.status(500).send("Token transfer txn may have failed");
        });
    } catch (err) {
        console.log("Transfer failed", err.toString());
    }
});

app.post("/claim", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webClaimType");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        let txnProps = {
            from: fromAddress,
            nonce: nonce,
            gas: gasLimit,
            gasPrice: gasPrice
        }

        multiNFTInstance.webClaimType(req.body.name, req.body.oldOwner, req.body.newOwner, txnProps).then(result => {

            updateNonceSlot(slot, "webClaimType");

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
            } else {
                console.log("Claim not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Claim txn with nonce " + nonce + " failed", err.toString());
            handleTxnErr(err, "webClaimType", slot, nonce);
            res.status(500).send("Claim txn may have failed");
        });
    } catch (err) {
        console.log('Claim failed', err.toString());
    }
});

app.post("/seturi", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webSetUri");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        let txnProps = {
            from: fromAddress,
            nonce: nonce,
            gas: gasLimit,
            gasPrice: gasPrice
        }

        multiNFTInstance.webSetTokenURI(req.body.tokenId, req.body.uri, req.body.owner, txnProps).then(result => {
            
            updateNonceSlot(slot, "webSetUri");

            if (result && result.receipt) {
                logResult(result);
                let data = {
                    tokenId: req.body.tokenId,
                    uri: req.body.uri,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash
                }
                db.collection("uriChanges" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added token uri change to firestore with id: ", ref.id);
                });
            } else {
                console.log("Token uri change not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Token uri change txn with nonce " + nonce + " failed", err.toString());
            handleTxnErr(err, "webSetUri", slot, nonce);
            res.status(500).send("Token uri change txn may have failed");
        });
    } catch (err) {
        console.log('Token uri change failed', err.toString());
    }
});

app.listen(port, () => console.log("Listening on port " + port));
