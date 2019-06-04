const request = require("request-promise");

let owner = "loadtest";
let newOwner = "0x221FD8BaF9030BbD17e22A28479e68AE1418Ac2c";
//let url = "https://nftcompany.com";

// let types = [];
// let tokens = [];

let args = process.argv.slice(2);
let numTimes = args[0];
let url = args[1];

for (let i = 0; i < numTimes; i++) {
    create();
}

function create() {
    let rand = Math.random();
    var data = {
        name: "name" + rand,
        symbol: "sym" + rand
    };
    // check if NFT exists, then create
    sendGetReq("/nftexists", data, true, function(exists) {
        var message;
        if (exists.nameExists) {
            message = "An NFT with the same name";
        }
        if (exists.symbolExists) {
            if (message) {
                message += " and symbol";
            } else {
                message = "An NFT with the same symbol";
            }
        }
        if (message) {
            console.error("NFT exists");
        } else {
            // add to activity
            let activity = {
                action: "Create NFT",
                updatedAt: new Date().getTime(),
                status: "Pending",
                owner: owner
            };
            sendPostReq("/addactivity", activity, true, function(activityId) {
                console.log("Added activity create");

                // call create
                data.owner = owner;
                data.uri = "/img/ph4.png";
                data.activityId = activityId;
                sendPostReq("/create", data, true, createResult => {
                    //types.push(data);
                    console.log("create success",
                        createResult.receipt.transactionHash,
                        createResult.receipt.status
                    );
                    mint(data.name);
                });
            });
        }
    });
}

function mint(name) {
    let activity = {
        action: "Mint tokens",
        updatedAt: new Date().getTime(),
        status: "Pending",
        owner: owner
    };
    sendPostReq("/addactivity", activity, true, function(activityId) {
        console.log("Added activity mint");

        // call mint
        // let rand = getRandomInt(0, types.length - 1);
        // let type = types[rand];
        var data = {
            name: name,
            count: 3,
            uri: "/img/ph3.png",
            owner: owner,
            activityId: activityId
        };
        sendPostReq("/mint", data, true, result => {
            console.log("mint success",
                result.receipt.transactionHash,
                result.receipt.status
            );
            let tokens = result.logs[0].args.tokenIds;
            // set uri for token 0
            setUri(tokens[0], name);

            // send token 1
            send(tokens[1]);

            // claim the type
            claim(name);
        });
    });
}

function setUri(token, type) {
    let activity = {
        action: "Set URI",
        updatedAt: new Date().getTime(),
        status: "Pending",
        owner: owner
    };
    sendPostReq("/addactivity", activity, true, function(activityId) {
        console.log("Added activity set uri");

        var data = {
            tokenId: token,
            owner: owner,
            uri: "/img/ph5.png",
            type: type,
            activityId: activityId
        };
        sendPostReq("/seturi", data, true, function(result) {
            console.log("set uri success",
                result.receipt.transactionHash,
                result.receipt.status
            );
        });
    });
}

function send(token) {
    let activity = {
        action: "Send",
        updatedAt: new Date().getTime(),
        status: "Pending",
        owner: owner
    };
    sendPostReq("/addactivity", activity, true, function(activityId) {
        console.log("Added activity send");

        var data = {
            to: newOwner,
            owner: owner,
            tokenId: token,
            activityId: activityId
        };
        sendPostReq("/transfer", data, true, function(result) {
            console.log("send success",
                result.receipt.transactionHash,
                result.receipt.status
            );
        });
    });
}

function claim(name) {
    let activity = {
        action: "Claim NFT",
        updatedAt: new Date().getTime(),
        status: "Pending",
        owner: owner
    };
    sendPostReq("/addactivity", activity, true, function(activityId) {
        console.log("Added activity claim");

        var data = {
            name: name,
            oldOwner: owner,
            newOwner: newOwner,
            activityId: activityId
        };
        sendPostReq("/claim", data, true, function(result) {
            console.log("claim success",
                result.receipt.transactionHash,
                result.receipt.status
            );
        });
    });
}

//Returns a random integer between min (inclusive) and max (inclusive)
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sendPostReq(path, data, async, cb) {
    request({
        uri: url + path,
        method: "POST",
        body: data,
        json: true,
        timeout: 180*1000
    }).then(resp => {
        cb(resp);
    }).catch(err => {
        console.error(err.toString());
    })
}

function sendGetReq(path, data, async, cb) {
    request({
            uri: url + path,
            method: "GET",
            qs: data,
            json: true,
            timeout: 180*1000
        })
        .then(resp => {
            cb(resp);
        })
        .catch(err => {
            console.error(err.toString());
        });
}