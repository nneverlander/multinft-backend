require("dotenv").config();

const express = require("express");
const app = express();
app.use(express.json());

const firebase = require("firebase-admin");
firebase.initializeApp();
const db = firebase.firestore();
const rootRefSuffix = process.env.FIRESTORE_ROOT_REF_SUFFIX || "-prod";

const HDWalletProvider = require("truffle-hdwallet-provider");
const web3 = require("web3");
const truffleContract = require("truffle-contract");
const multiNFTJson = require("./MultiNFT.json");
const MultiNFT = truffleContract(multiNFTJson);
let multiNFTInstance;
let web3js;
let fromAddress = process.env.FROM_ADDRESS;
let removeAccountListener;

// value can be 0 or 1 indicating whether the slot is free or not. 0 is free
let slots = new Int8Array(50);
// lowest nonce holds the nonce of the last confirmed txn for this address
let lowestNonce = 0;
// indicates the number of slots full
let slotsUsed = 0;

const port = process.env.PORT || 3000;

init();

async function init() {
    let provider = process.env.WEB3_PROVIDER;
    let contractAddress = process.env.MULTINFT_CONTRACT_ADDR;
    let privKey = process.env.PRIV_KEY;
    let gasLimit = process.env.GAS_LIMIT;
    let gasPrice = process.env.GAS_PRICE_WEI;

    let currentConfig = await db.collection("config").doc("current").get();
    let version = currentConfig.data().version;
    let config = await db.collection("config").doc(version).get();
    let configData =config.data();

    let accounts = await getNewFromAddress();
    let account = accounts.docs[0];
    let accountData = account.data();
    lowestNonce = accountData.nonce;
    slotsUsed = accountData.slotsUsed;

    if (!privKey) {
        privKey = accountData.privKey;
    }
    if (!fromAddress) {
        fromAddress = account.id;
    }

    if (!provider) {
        provider = configData.web3Provider;
    }
    if (!contractAddress) {
        contractAddress = configData.multiNFTContractAddress;
    }
    if (!gasLimit) {
        gasLimit = configData.gasLimit;
    }
    if (!gasPrice) {
        gasPrice = configData.gasPriceWei;
    }

    let web3Provider = new HDWalletProvider(privKey, provider);
    web3js = new web3(web3Provider, undefined, {transactionConfirmationBlocks: 1});

    MultiNFT.setProvider(web3Provider);
    MultiNFT.defaults({
        from: fromAddress,
        gas: gasLimit,
        gasPrice: gasPrice,
        value: 0
    })
    MultiNFT.numberFormat = "String";

    multiNFTInstance = await MultiNFT.at(contractAddress);

    registerAccountListener();
}

function registerAccountListener() {
    let account = db.collection("accounts" + rootRefSuffix).doc(fromAddress);
    removeAccountListener = account.onSnapshot(doc => {
        let changedNonce = doc.data().nonce;
        if (changedNonce > lowestNonce) {
            lowestNonce = changedNonce;
            console.log("Lowest nonce updated to " + lowestNonce + " after listener reported a change");
        }
    });
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

function getNewFromAddress() {
    let prom = db.collection("accounts" + rootRefSuffix).orderBy("slotsUsed", "asc").limit(1).get();
    return prom;
}

function sendDummyTxn(slot, slotsUsed) {
    // send a dummy txn to fill up the freed slot so that any txns with higher nonces can proceed
    // this condition means there is a "gap" in the array
    // without this gap being filled, txns with higher nonces will not complete
    // so send a dummy txn with nonce corresponding to this slot
    if (slotsUsed > slot) {
        console.log("Sending dummy txn to have nonce gap filled");
        let nonce = lowestNonce + slot;
        multiNFTInstance.sendTransaction({from: fromAddress, nonce: nonce, value: 0});
    }
}

app.get("/", async function(req, res) {
    res.send("Hello");
});

app.get("/slotsused", async function(req, res) {
    res.send("Slots used: " + slotsUsed);
});

app.post("/resetslotsfirebase", async function(req, res) {
    // update firebase
    let updateData = {
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        slotsUsed: 0
    };
    db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(updateData, {merge: true}).then(update => {
        console.log("Updated firebase doc " + fromAddress + " during reset slots with data: " + JSON.stringify(updateData));
        res.status(200).send("Resetting slots successful");
    }).catch(err => {
        console.log("Updating firebase during reset slots failed ", err);
        res.status(500).send("Resetting slots failed");
    })
});

app.post("/setslotsfirebase", async function(req, res) {
    // update firebase
    let updateData = {
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        slotsUsed: slotsUsed
    };
    db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(updateData, {merge: true}).then(update => {
        console.log("Updated firebase doc " + fromAddress + " during set slots with data: " + JSON.stringify(updateData));
        res.status(200).send("Setting slots successful");
    }).catch(err => {
        console.log("Updating firebase during set slots failed ", err);
        res.status(500).send("Setting slots failed");
    })
});

app.post("/removelistener", async function(req, res) {
    removeAccountListener();
    res.end();
});

app.post("/resetnonce", async function(req, res) {
    web3js.eth.getTransactionCount(fromAddress, "pending").then(count => {
        lowestNonce = count;
        // update firebase
        let updateData = {
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            nonce: lowestNonce
        };
        db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(updateData, {merge: true}).then(nonceUpdate => {
            console.log("Updated firebase doc " + fromAddress + " during reset nonce with data: " + JSON.stringify(updateData));
            res.status(200).send("Nonce reset");
        }).catch(err => {
            console.log("Updating firebase during reset nonce failed ", err);
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

        let from;
        let nonce;
        let newAddressUsed = false;
        let slot;

        if (slotsUsed > slots.length) {
            console.log("All slots for address " + fromAddress + " are currently full. Fetching a new address");
            let snapshot = await getNewFromAddress();
            let newAddress = snapshot.docs[0];
            let newAddressData = newAddress.data();
            let slotsFull = newAddressData.slotsUsed + 1;
            if (slotsFull > slots.length) {
                console.log("All slots in all available addresses are full. Cannot execute txn at this moment. Try again later")
                return;
            }
            from = newAddress.id;
            nonce = newAddressData.nonce;
            newAddressUsed = true;
        } else {
            slot = getSlot();
            from = fromAddress;
            nonce = lowestNonce + slot;
            slots[slot] = 1;
            slotsUsed++;

            console.log("Using slot " + slot + ", slots used as of now: " + slotsUsed);

            let updateData = {
                lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                nonce: nonce,
                slotsUsed: slotsUsed
            };

            // update firebase
            db.collection("accounts" + rootRefSuffix).doc(from).set(updateData, {merge: true}).then(nonceUpdate => {
                console.log("Updated firebase doc " + from + " before txn execution with data: " + JSON.stringify(updateData));
            }).catch(err => {
                console.log("Updating firebase before txn execution failed ", err);
            })
        }

        console.log("Using nonce " + nonce + " and from address: " + from);

        multiNFTInstance.webCreateType(req.body.name, req.body.symbol, req.body.uri, req.body.owner, {nonce: nonce, from: from}).then(result => {
            console.log(result);

            ++nonce;
            let newData = {
                lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }
            if (!newAddressUsed) {
                // possible when there are concurrent txns
                if (nonce > lowestNonce) {
                    lowestNonce = nonce;
                    newData.nonce = nonce;
                }
                slots[slot] = 0;
                slotsUsed--;
                newData.slotsUsed = slotsUsed;
            } else {
                newData.nonce = nonce;
            }

            // update firebase
            db.collection("accounts" + rootRefSuffix).doc(from).set(newData, {merge: true}).then(nonceUpdate => {
                console.log("Updated firebase doc " + from + " after txn execution with data: " + JSON.stringify(newData));
            }).catch(err => {
                console.log("Updating firebase after txn execution failed ", err);
            })

            // add result to firebase
            if (result && result.receipt && result.logs) {
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
                    console.log("Added type to firestore with id: ", ref.id);
                });
            } else {
                console.log("Type not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            //todo: fix this hack parsing
            let message = "Message: " + err;
            // txn has been mined and hence nonce is incremented
            if (message.includes("transactionHash")) {
                nonce++;
            }

            let newData = {
                lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }
            if (!newAddressUsed) {
                // possible when there are concurrent txns
                if (nonce > lowestNonce) {
                    lowestNonce = nonce;
                    newData.nonce = nonce;
                }
                slots[slot] = 0;
                slotsUsed--;
                newData.slotsUsed = slotsUsed;
                // since this txn failed, see if this slot needs to be filled
                // need to call this only when nonce is not mined
                if (!message.includes(transactionHash)) {
                    sendDummyTxn(slot, slotsUsed);
                }
            } else {
                newData.nonce = nonce;
            }

            db.collection("accounts" + rootRefSuffix).doc(from).set(newData, {merge: true}).then(nonceUpdate => {
                console.log("Firebase doc " + from + " updated after failed txn with data: " + JSON.stringify(newData));
            }).catch(err => {
                console.log("Updating firebase after failed txn failed ", err);
            })

            console.log("Create type txn failed", err);
            res.status(500).send("Create type txn may have failed");

        });
    } catch (err) {
        console.log('Create type failed', err);
    }
});

app.post("/mint", async function(req, res) {
    try {
        multiNFTInstance.webMint(req.body.name, req.body.uri, req.body.count, req.body.owner).then(result => {
            console.log(result);
            // add result to firebase
            if (result && result.receipt && result.logs) {
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
                    console.log("Added mints to firestore with id: ", ref.id);
                });
            } else {
                console.log("Mints not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Mint txn failed", err);
            res.status(500).send("Mint may have failed");
        });
    } catch (err) {
        console.log('Mint failed', err);
    }
});

app.post("/transfer", async function(req, res) {
    try {
        multiNFTInstance.webTransfer(req.body.to, req.body.tokenId, req.body.owner).then(result => {
            console.log(result);
            // add result to firebase
            if (result && result.receipt) {
                let data = {
                    tokenId: req.body.tokenId,
                    to: req.body.to,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash
                }
                db.collection("tokenTransfers" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added token transfer to firestore with id: ", ref.id);
                });
            } else {
                console.log("Token transfer not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Token transfer txn failed", err);
            res.status(500).send("Token transfer txn may have failed");
        });
    } catch (err) {
        console.log('Transfer failed', err);
    }
});

app.post("/claim", async function(req, res) {
    try {
        multiNFTInstance.webClaimType(req.body.name, req.body.oldOwner, req.body.newOwner).then(result => {
            console.log(result);
            // add result to firebase
            if (result && result.receipt && result.logs) {
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
                db.collection("typeClaims" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added claim to firestore with id: ", ref.id);
                });
            } else {
                console.log("Claim not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Claim txn failed", err);
            res.status(500).send("Claim txn may have failed");
        });
    } catch (err) {
        console.log('Claim failed', err);
    }
});

app.post("/seturi", async function(req, res) {
    try {
        multiNFTInstance.webSetTokenURI(req.body.tokenId, req.body.uri, req.body.owner).then(result => {
            console.log(result);
            // add result to firebase
            if (result && result.receipt) {
                let data = {
                    tokenId: req.body.tokenId,
                    uri: req.body.uri,
                    owner: req.body.owner,
                    txn: result.receipt.transactionHash
                }
                db.collection("tokenUriChanges" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added token uri change to firestore with id: ", ref.id);
                });
            } else {
                console.log("Token uri change not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Token uri change txn failed", err);
            res.status(500).send("Token uri change txn may have failed");
        });
    } catch (err) {
        console.log('Token uri change failed', err);
    }
});

app.listen(port, () => console.log("Listening on port " + port));
