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
let fromAddress = process.env.FROM_ADDRESS;
let removeAccountListener;

// value can be 0 or 1 indicating whether the slot is free or not. 0 is free
let slots = new Int8Array(50);
// lowest nonce holds the nonce of the last confirmed txn for this address
let lowestNonce = 0;
// indicates the number of slots full
let slotsUsed = 0;

let lastUpdatedFireStoreNonce = 0;

const port = process.env.PORT || 3000;

init();

async function init() {
    let provider = process.env.web3Provider;
    let contractAddress = process.env.multiNFTContractAddress;
    let privKey = process.env.privKey;
    let gasLimit = process.env.gasLimit;
    let gasPrice = process.env.gasPriceWei;

    let currentConfig = await db.collection("config").doc("current").get();
    let version = currentConfig.data().version;
    let config = await db.collection("config").doc(version).get();
    let configData =config.data();

    if (!rootRefSuffix) {
        rootRefSuffix = configData.rootRefSuffix;
    }

    let accounts = await getNewFromAddress();
    let account = accounts.docs[0];
    let accountData = account.data();
    lowestNonce = accountData.nonce;

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

    // update firestore nonce every 10 seconds
    setInterval(updateFirestoreNonce, 10*1000);
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
    let prom = db.collection("accounts" + rootRefSuffix).orderBy("lastUpdatedAt", "asc").limit(1).get();
    return prom;
}

function sendDummyTxn(slot) {
    // send a dummy txn to fill up the freed slot so that any txns with higher nonces can proceed
    // this condition means there is a "gap" in the array
    // without this gap being filled, txns with higher nonces will not complete
    // so send a dummy txn with nonce corresponding to this slot
    if (slotsUsed > slot) {
        let nonce = lowestNonce + slot;
        console.log("Sending dummy txn to have nonce gap filled with nonce " + nonce + " in slot " + slot + " when lowestNonce is " + lowestNonce);
        multiNFTInstance.sendTransaction({from: fromAddress, nonce: nonce, value: 0}).then(result => {
            console.log("Dummy txn with nonce " + nonce + " succeeded when lowestNonce is " + lowestNonce);
            lowestNonce++;
            slots[slot] = 0;
            slotsUsed--;
        }).catch(err => {
            //reset program nonce to account nonce
            console.log("Dummy txn with nonce " + nonce + " failed when lowestNonce is " + lowestNonce);
            slots[slot] = 0;
            slotsUsed--;
            web3js.eth.getTransactionCount(fromAddress, "pending").then(count => {
                console.log("Program nonce " + lowestNonce + " is being reset to account nonce " + count);
                lowestNonce = count;
            }).catch(error => {
                console.log("Error while getting account nonce ", error);
            });
        });
    } else {
        slots[slot] = 0;
        slotsUsed--;
    }
}

function prepareNonceSlot(txn) {
    let nonce;
    let slot;
    if (slotsUsed > slots.length) {
        console.log("All slots for address " + fromAddress + " are currently full. Cannot execute " + txn + " at this moment. Try again later");
        return;
    } else {
        slot = getSlot();
        nonce = lowestNonce + slot;
        slots[slot] = 1;
        slotsUsed++;
    }
    console.log("For " + txn + ", using nonce " + nonce + ", from address: " + fromAddress + ", slot " + slot + ". Slots used so far: " + slotsUsed);
    return [nonce, slot];
}

// currently called periodically
function updateFirestoreNonce() {
    if (lastUpdatedFireStoreNonce == lowestNonce) {
        // no change
        return;
    }
    lastUpdatedFireStoreNonce = lowestNonce;
    let newData = {
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        nonce: lowestNonce
    }
    db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(newData, {merge: true}).then(result => {
        console.log("Updated firebase doc " + fromAddress + " with data: " + JSON.stringify(newData));
    }).catch(err => {
        console.log("Updating firebase failed ", err);
    })
}

function updateNonceSlot(slot, txn) {
    lowestNonce++;
    slots[slot] = 0;
    slotsUsed--;
}

function handleTxnErr(err, txn, slot) {
    //todo: fix this hack parsing
    let message = "Message: " + err;
    // txn has been mined and hence nonce is incremented
    if (message.includes("transactionHash")) {
        lowestNonce++;
        slots[slot] = 0;
        slotsUsed--;
    } else {
        // since this txn failed, see if this slot needs to be filled
        // need to call this only when nonce is not mined
        sendDummyTxn(slot);
    }
}

app.get("/", async function(req, res) {
    res.send("Hello");
});

app.get("/slotsused", async function(req, res) {
    res.send("Slots used: " + slotsUsed);
});

app.get("/nonce", async function(req, res) {
    web3js.eth.getTransactionCount(fromAddress, "pending").then(count => {
        res.send("Program nonce: " + lowestNonce + ", account nonce: " + count);
    }).catch(error => {
        console.log("Error while getting nonce ", error);
        res.status(500).send("Error occured while getting nonce");
    });
});

app.post("/resetnonce", async function(req, res) {
    web3js.eth.getTransactionCount(fromAddress, "pending").then(count => {
        console.log("Resetting program nonce " + lowestNonce + " to account nonce " + count);
        lowestNonce = count;
        // update firebase
        let updateData = {
            lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            nonce: lowestNonce
        };
        db.collection("accounts" + rootRefSuffix).doc(fromAddress).set(updateData, {merge: true}).then(nonceUpdate => {
            console.log("Updated firebase doc " + fromAddress + " during reset nonce with data: " + JSON.stringify(updateData));
            res.status(200).send("Nonce reset to " + lowestNonce);
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

        let nonceSlot = prepareNonceSlot("webCreateType");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        multiNFTInstance.webCreateType(req.body.name, req.body.symbol, req.body.uri, req.body.owner, {nonce: nonce, from: fromAddress}).then(result => {
            console.log(result);
            updateNonceSlot(slot, "webCreateType");

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
                    console.log("Added type " + req.body.name + " to firestore with id: ", ref.id);
                });
            } else {
                console.log("Type " + req.body.name + " not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Create type txn failed", err);
            handleTxnErr(err, "webCreateType", slot);
            res.status(500).send("Create type txn may have failed");
        });
    } catch (err) {
        console.log("Create type " + req.body.name + " failed", err);
    }
});

app.post("/mint", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webMint");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        multiNFTInstance.webMint(req.body.name, req.body.uri, req.body.count, req.body.owner, {nonce: nonce, from: fromAddress}).then(result => {
            console.log(result);
            updateNonceSlot(slot, "webMint");

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
                    console.log("Added " + req.body.count + " mints of type " + req.body.name + " to firestore with id: ", ref.id);
                });
            } else {
                console.log("Mints of type " + req.body.name + " not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Mint txn failed", err);
            handleTxnErr(err, "webMint", slot);
            res.status(500).send("Mint may have failed");
        });
    } catch (err) {
        console.log("Minting of " + req.body.name + " failed", err);
    }
});

app.post("/transfer", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webTransfer");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        multiNFTInstance.webTransfer(req.body.to, req.body.tokenId, req.body.owner, {nonce: nonce, from: fromAddress}).then(result => {
            console.log(result);
            updateNonceSlot(slot, "webTransfer");

            // add result to firebase
            if (result && result.receipt) {
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
            console.log("Token transfer txn failed", err);
            handleTxnErr(err, "webTransfer", slot);
            res.status(500).send("Token transfer txn may have failed");
        });
    } catch (err) {
        console.log("Transfer failed", err);
    }
});

app.post("/claim", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webClaimType");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        multiNFTInstance.webClaimType(req.body.name, req.body.oldOwner, req.body.newOwner, {nonce: nonce, from: fromAddress}).then(result => {
            console.log(result);
            updateNonceSlot(slot, "webClaimType");

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
                db.collection("claims" + rootRefSuffix).add(data).then(ref => {
                    console.log("Added claim to firestore with id: ", ref.id);
                });
            } else {
                console.log("Claim not added to firestore");
            }
            res.send(result);
        }).catch(err => {
            console.log("Claim txn failed", err);
            handleTxnErr(err, "webClaimType", slot);
            res.status(500).send("Claim txn may have failed");
        });
    } catch (err) {
        console.log('Claim failed', err);
    }
});

app.post("/seturi", async function(req, res) {
    try {
        let nonceSlot = prepareNonceSlot("webSetUri");
        let nonce = nonceSlot[0];
        let slot = nonceSlot[1];

        multiNFTInstance.webSetTokenURI(req.body.tokenId, req.body.uri, req.body.owner, {nonce: nonce, from: fromAddress}).then(result => {
            console.log(result);
            updateNonceSlot(slot, "webSetUri");

            // add result to firebase
            if (result && result.receipt) {
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
            console.log("Token uri change txn failed", err);
            handleTxnErr(err, "webSetUri", slot);
            res.status(500).send("Token uri change txn may have failed");
        });
    } catch (err) {
        console.log('Token uri change failed', err);
    }
});

app.listen(port, () => console.log("Listening on port " + port));
