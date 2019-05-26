require("dotenv").config();

const express = require("express");
const app = express();
app.use(express.json());

const firebase = require("firebase-admin");
firebase.initializeApp();
const db = firebase.firestore();
const configRef = db.collection("config");
const firestoreRootRef = process.env.FIRESTORE_ROOT_REF || "prod";
const rootRef = db.collection(firestoreRootRef);

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

    let web3Provider = new HDWalletProvider(privKey, provider);

    MultiNFT.setProvider(web3Provider);
    MultiNFT.defaults({
        from: fromAddress,
        gas: gasLimit,
        value: 0
    })

    multiNFTInstance = await MultiNFT.at(contractAddress);
}

async function addToFirebase() {
    let data = {
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    let result = await rootRef.add(data);
    return result;
}

app.get("/", async function(req, res) {
    // let result = await addToFirebase();
    // res.send(result);

});

app.post("/create", async function(req, res) {
    // check name, symbol already exist
    // add to firebase
    // run eth txn in bg
    // once result arrives, update firebase or retry if failed
    try {
        let result = await multiNFTInstance.webCreateType(req.body.name, req.body.symbol, req.body.uri, req.body.owner);
        console.log(result);
        res.send(result);
    } catch (err) {
        console.log('Create type failed', err);
    }
});

app.post("/mint", async function(req, res) {
    
});

app.post("/transfer", async function(req, res) {
    
});

app.post("/claim", async function(req, res) {
    
});

app.post("/setUri", async function(req, res) {
    
});

app.listen(port, () => console.log("Listening on port " + port));
