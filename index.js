const web3 = require("web3");
const express = require("express");
const Tx = require("ethereumjs-tx");
const app = express();
const crypto = require("crypto");
const truffleContract = require("truffle-contract");
require("dotenv").config();

app.use(express.json());

const port = process.env.PORT;
const web3Provider = new web3.providers.HttpProvider(process.env.WEB3_PROVIDER);
const web3js = new web3(web3Provider, undefined, {
    transactionConfirmationBlocks: 1
});

const firebase = require("firebase-admin");
firebase.initializeApp();

const multiNFTJson = require("./MultiNFT.json");

const db = firebase.firestore();
const configRef = db.collection("config").doc("current");
// const huntersRef = rootRef.doc(process.env.FIREBASE_HUNTERS_REF);
// const huntersKeysRef = huntersRef.collection(process.env.FIREBASE_KEYS_REF);

// async function sendSatTreasureKeyNFT(hunter) {
//     const fromAddress = process.env.SATOSHI_TREASURER_APPROVER_ADDR;
//     const privateKey = Buffer.from(
//         process.env.SATOSHI_TREASURER_APPROVER_PRIV_KEY,
//         "hex"
//     );
//     const contractAddress = process.env.MAVRIK_CONTRACT_ADDR;
//     const mavrik = new web3js.eth.Contract(mavrikJson.abi, contractAddress);
//     // get transaction count, later will used as nonce
//     let count = await web3js.eth.getTransactionCount(fromAddress, "pending");
//     let rawTransaction = {
//         from: fromAddress,
//         gasPrice: web3js.utils.toHex(20 * 1e9),
//         gasLimit: web3js.utils.toHex(210000),
//         to: contractAddress,
//         data: mavrik.methods
//             .mintNonFungible(process.env.SATOSHI_TREASURE_KEY_NFT_TYPE, [
//                 hunter
//             ])
//             .encodeABI(),
//         nonce: web3js.utils.toHex(count)
//     };
//     //console.log(rawTransaction);
//     let transaction = new Tx(rawTransaction);
//     transaction.sign(privateKey);
//     let txResult = await web3js.eth.sendSignedTransaction(
//         "0x" + transaction.serialize().toString("hex")
//     );
//     console.log(txResult);
//     return txResult;
// }

async function addToFirebase() {
    let data = {
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    let currentEnv = await configRef.get();
    let rootRef = currentEnv.data().env;
    let result = await db.collection(rootRef).add(data);
    return result;
}

// app.get("/", async function(req, res) {
//     let result = await addToFirebase();
//     res.send(result);   
// });

app.post("/create", async function(req, res) {
    
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
