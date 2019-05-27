require("dotenv").config();

const express = require("express");
const app = express();
app.use(express.json());

const firebase = require("firebase-admin");
firebase.initializeApp();
const db = firebase.firestore();
const configRef = db.collection("config");
const rootRefSuffix = process.env.FIRESTORE_ROOT_REF_SUFFIX || "-prod";

const HDWalletProvider = require("truffle-hdwallet-provider");
const truffleContract = require("truffle-contract");
const multiNFTJson = require("./MultiNFT.json");
const MultiNFT = truffleContract(multiNFTJson);
let multiNFTInstance;

const port = process.env.PORT || 3000;

init();

async function init() {
    let provider = process.env.WEB3_PROVIDER;
    let contractAddress = process.env.MULTINFT_CONTRACT_ADDR;
    let privKey = process.env.PRIV_KEY;
    let fromAddress = process.env.FROM_ADDRESS;
    let gasLimit = process.env.GAS_LIMIT;
    let gasPrice = process.env.GAS_PRICE_WEI;

    let currentConfig = await configRef.doc("current").get();
    let version = currentConfig.data().version;
    let config = await configRef.doc(version).get();
    let configData =config.data();

    if (!provider) {
        provider = configData.WEB3_PROVIDER;
    }
    if (!contractAddress) {
        contractAddress = configData.MULTINFT_CONTRACT_ADDR;
    }
    if (!privKey) {
        privKey = configData.PRIV_KEY;
    }
    if (!fromAddress) {
        fromAddress = configData.FROM_ADDRESS;
    }
    if (!gasLimit) {
        gasLimit = configData.GAS_LIMIT;
    }
    if (!gasPrice) {
        gasPrice = configData.GAS_PRICE_WEI;
    }

    let web3Provider = new HDWalletProvider(privKey, provider);

    MultiNFT.setProvider(web3Provider);
    MultiNFT.defaults({
        from: fromAddress,
        gas: gasLimit,
        gasPrice: gasPrice,
        value: 0
    })
    MultiNFT.numberFormat = "String";

    multiNFTInstance = await MultiNFT.at(contractAddress);
}

app.get("/", async function(req, res) {
    res.send("Hello");
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
        multiNFTInstance.webCreateType(req.body.name, req.body.symbol, req.body.uri, req.body.owner).then(result => {
            console.log(result);
            // add to firebase
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
            console.log("Create type txn failed", err);
            res.status(500).send("Ethereum create type txn failed");
        });
    } catch (err) {
        console.log('Create type failed', err);
    }
});

app.post("/mint", async function(req, res) {
    try {
        multiNFTInstance.webMint(req.body.name, req.body.uri, req.body.count, req.body.owner).then(result => {
            console.log(result);
            // add to firebase
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
            res.status(500).send("Ethereum mint txn failed");
        });
    } catch (err) {
        console.log('Mint failed', err);
    }
});

app.post("/transfer", async function(req, res) {
    try {
        multiNFTInstance.webTransfer(req.body.to, req.body.tokenId, req.body.owner).then(result => {
            console.log(result);
            // add to firebase
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
            res.status(500).send("Ethereum token transfer txn failed");
        });
    } catch (err) {
        console.log('Mint failed', err);
    }
});

app.post("/claim", async function(req, res) {
    try {
        multiNFTInstance.webClaimType(req.body.name, req.body.oldOwner, req.body.newOwner).then(result => {
            console.log(result);
            // add to firebase
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
            res.status(500).send("Ethereum claim txn failed");
        });
    } catch (err) {
        console.log('Mint failed', err);
    }
});

app.post("/seturi", async function(req, res) {
    try {
        multiNFTInstance.webSetTokenURI(req.body.tokenId, req.body.uri, req.body.owner).then(result => {
            console.log(result);
            // add to firebase
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
            res.status(500).send("Ethereum token uri change txn failed");
        });
    } catch (err) {
        console.log('Mint failed', err);
    }
});

app.listen(port, () => console.log("Listening on port " + port));
