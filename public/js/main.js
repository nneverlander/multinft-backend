var db;
var rootRefSuffix = "-ropsten";
var owner = localStorage.getItem("owner");
var explorer = "https://ropsten.etherscan.io/tx/";
let state = { view: "home" };

$(async function() {
    window.history.replaceState(state, null, "");

    window.onpopstate = function(event) {
        if (event.state) {
            let view = event.state.view;
            console.log("Rendering " + view);

            switch (view) {
                case "home":
                    showHome();
                    break;
                case "activity":
                    showActivity();
                    break;
                case "tokens":
                    fetchTokens(event.state.type);
                    break;
                default:
                    showHome();
            }
        }
    };

    var firebaseConfig = {
        apiKey: "AIzaSyCljSAoHk-HJpamP9pMd5C5mYU97VgSzvM",
        authDomain: "multinft-backend.firebaseapp.com",
        databaseURL: "https://multinft-backend.firebaseio.com",
        projectId: "multinft-backend",
        storageBucket: "multinft-backend.appspot.com",
        messagingSenderId: "416183196622",
        appId: "1:416183196622:web:a073d72d2375322b"
    };
    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    // whether rospten, mainnet, matic or other
    await initNetwork();

    // claim button disabled by default
    $("#claimBtn").prop("disabled", true);
    // owner field in create hidden by default
    $("#createOwnerDiv").hide();
    //activity hidden by default
    $("#activityRoot").hide();
    $("#tokensList").hide();

    if (!owner) {
        console.log("No owner in local storage");
        $("#whoAmISpan").html("empty");
        $("#createOwnerDiv").show();
        $("#welcome").modal("show");
    } else {
        fetchTypes();
        $("#whoAmISpan").html(owner);
    }

    $("#navBarTokens").on("click", function(e) {
        e.preventDefault();
        state.view = "home";
        window.history.pushState(state, null, "");
        showHome();
    });

    $("#logo").on("click", function(e) {
        e.preventDefault();
        state.view = "home";
        window.history.pushState(state, null, "");
        showHome();
    });

    $("#navBarActivity").on("click", function(e) {
        e.preventDefault();
        state.view = "activity";
        window.history.pushState(state, null, "");
        showActivity();
    });

    $("#welcomeFetch").click(function(e) {
        e.preventDefault();
        owner = $("#welcomeOwner").val();
        if (!owner) {
            $("#welcomeOwner")
                .tooltip("hide")
                .attr("data-original-title", "Owner can't be empty")
                .tooltip("show");
            disposeTooltip("#welcomeOwner");
            return;
        }
        $("#welcome").modal("hide");

        localStorage.setItem("owner", owner);
        $("#whoAmISpan").html(owner);
        $("#createOwnerDiv").hide();
        fetchTypes();
    });

    $("#changeOwnerBtn").click(function(e) {
        e.preventDefault();
        owner = $("#changeOwner").val();
        if (!owner) {
            $("#changeOwner")
                .tooltip("hide")
                .attr("data-original-title", "You can't be empty")
                .tooltip("show");
            disposeTooltip("#changeOwner");
            return;
        }
        $("#whoAmIModal").modal("hide");

        localStorage.setItem("owner", owner);
        location.reload();
    });

    $("#createBtn").click(function(e) {
        e.preventDefault();
        // input validation
        var name = $("#name").val();
        if (!name) {
            $("#name")
                .tooltip("hide")
                .attr("data-original-title", "Name can't be empty")
                .tooltip("show");
            disposeTooltip("#name");
            return;
        }
        var symbol = $("#symbol").val();
        if (!symbol) {
            $("#symbol")
                .tooltip("hide")
                .attr("data-original-title", "Symbol can't be empty")
                .tooltip("show");
            disposeTooltip("#symbol");
            return;
        }

        if (!owner) {
            owner = $("#owner").val();
            if (!owner) {
                $("#owner")
                    .tooltip("hide")
                    .attr("data-original-title", "Owner can't be empty")
                    .tooltip("show");
                disposeTooltip("#owner");
                return;
            }
            localStorage.setItem("owner", owner);
            $("#whoAmISpan").html(owner);
            console.log("New owner " + owner + " set");
        }

        var $this = $(this);
        var loadingText = '<i class="fa fa-spinner fa-spin"></i> Creating';
        if ($(this).html() !== loadingText) {
            $this.data("original-text", $(this).html());
            $this.html(loadingText);
        }
        setTimeout(function() {
            $this.html($this.data("original-text"));
        }, 3000);

        $("#welcome").modal("hide");

        $("#createBtn").prop("disabled", true);

        var data = {
            name: $("#name").val(),
            symbol: $("#symbol").val()
        };
        // check if NFT exists, then create
        sendGetReq("/nftexists", data, true, function(exists) {
            // wait for 3 seconds to check for name and symbol exists
            //setTimeout(showSuccessAlert, 3000);

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
                Swal.fire({
                    type: "error",
                    title: "NFT exists",
                    text: message + " exists",
                    customClass: {
                        confirmButton: "swal-confirm-btn",
                        title: "swal-title"
                    }
                });
                $("#createBtn").prop("disabled", false);
            } else {
                // add to activity
                let activity = {
                    action: "Create NFT",
                    updatedAt: new Date().getTime(),
                    status: "Pending",
                    owner: owner
                };
                sendPostReq("/addactivity", activity, true, function(
                    activityId
                ) {
                    console.log("Added activity");

                    showSuccessAlert();
                    $("#createOwnerDiv").hide();
                    $("#create").modal("hide");
                    $("#createBtn").prop("disabled", false);

                    // call create
                    data.owner = owner;
                    data.uri = "";
                    data.activityId = activityId;
                    sendPostReq("/create", data, true, function(createResult) {
                        console.log(
                            createResult.receipt.transactionHash,
                            createResult.receipt.status
                        );
                    });
                });
            }
        });
    });

    $("#mintBtn").click(function(e) {
        e.preventDefault();
        // input validation
        var count = $("#mintCount").val();
        if (!count) {
            $("#mintCount")
                .tooltip("hide")
                .attr("data-original-title", "Count can't be empty")
                .tooltip("show");
            disposeTooltip("#mintCount");
            return;
        }
        if (count > 20) {
            $("#mintCount")
                .tooltip("hide")
                .attr("data-original-title", "Count must be less than 20")
                .tooltip("show");
            disposeTooltip("#mintCount");
            return;
        }
        if (!isInt(count)) {
            $("#mintCount")
                .tooltip("hide")
                .attr(
                    "data-original-title",
                    "Count must be an integer less than 20"
                )
                .tooltip("show");
            disposeTooltip("#mintCount");
            return;
        }

        var $this = $(this);
        var loadingText = '<i class="fa fa-spinner fa-spin"></i> Minting';
        if ($(this).html() !== loadingText) {
            $this.data("original-text", $(this).html());
            $this.html(loadingText);
        }
        setTimeout(function() {
            $this.html($this.data("original-text"));
        }, 3000);

        $("#mintBtn").prop("disabled", true);

        // add to activity
        let activity = {
            action: "Mint tokens",
            updatedAt: new Date().getTime(),
            status: "Pending",
            owner: owner
        };
        sendPostReq("/addactivity", activity, true, function(activityId) {
            console.log("Added activity");

            showSuccessAlert();
            $("#mint").modal("hide");
            $("#mintBtn").prop("disabled", false);

            // call mint
            var data = {
                name: $("#mintName").val(),
                count: $("#mintCount").val(),
                uri: "",
                owner: owner,
                activityId: activityId
            };
            sendPostReq("/mint", data, true, function(result) {
                console.log(
                    result.receipt.transactionHash,
                    result.receipt.status
                );
            });
        });
    });

    $("#claimBtn").click(function(e) {
        e.preventDefault();
        // input validation
        var claimAddr = $("#claimAddr").val();
        if (!claimAddr) {
            $("#claimAddr")
                .tooltip("hide")
                .attr("data-original-title", "Address can't be empty")
                .tooltip("show");
            disposeTooltip("#claimAddr");
            return;
        }
        if (claimAddr == "0" || claimAddr == "0x0") {
            $("#claimAddr")
                .tooltip("hide")
                .attr("data-original-title", "Address can't be zero")
                .tooltip("show");
            disposeTooltip("#claimAddr");
            return;
        }

        var $this = $(this);
        var loadingText = '<i class="fa fa-spinner fa-spin"></i> Claiming';
        if ($(this).html() !== loadingText) {
            $this.data("original-text", $(this).html());
            $this.html(loadingText);
        }
        setTimeout(function() {
            $this.html($this.data("original-text"));
        }, 3000);

        $("#claimBtn").prop("disabled", true);

        // add to activity
        let activity = {
            action: "Claim NFT",
            updatedAt: new Date().getTime(),
            status: "Pending",
            owner: owner
        };
        sendPostReq("/addactivity", activity, true, function(activityId) {
            console.log("Added activity");

            showSuccessAlert();
            $("#claim").modal("hide");
            $("#claimBtn").prop("disabled", false);

            var data = {
                name: $("#claimName").val(),
                oldOwner: owner,
                newOwner: $("#claimAddr").val(),
                activityId: activityId
            };
            sendPostReq("/claim", data, true, function(result) {
                console.log(
                    result.receipt.transactionHash,
                    result.receipt.status
                );
            });
        });
    });

    $("#setUriBtn").click(function(e) {
        e.preventDefault();
        // input validation
        var uriInput = $("#uriInput").val();
        if (!uriInput) {
            $("#uriInput")
                .tooltip("hide")
                .attr("data-original-title", "URI can't be empty")
                .tooltip("show");
            disposeTooltip("#uriInput");
            return;
        }

        var $this = $(this);
        var loadingText = '<i class="fa fa-spinner fa-spin"></i> Setting';
        if ($(this).html() !== loadingText) {
            $this.data("original-text", $(this).html());
            $this.html(loadingText);
        }
        setTimeout(function() {
            $this.html($this.data("original-text"));
        }, 3000);

        $("#setUriBtn").prop("disabled", true);

        // add to activity
        let activity = {
            action: "Set URI",
            updatedAt: new Date().getTime(),
            status: "Pending",
            owner: owner
        };
        sendPostReq("/addactivity", activity, true, function(activityId) {
            console.log("Added activity");

            showSuccessAlert();
            $("#setUri").modal("hide");
            $("#setUriBtn").prop("disabled", false);

            var data = {
                tokenId: $("#tokenIdUri").val(),
                owner: owner,
                uri: $("#uriInput").val(),
                type: $("#typeUri").val(),
                activityId: activityId
            };
            sendPostReq("/seturi", data, true, function(result) {
                console.log(
                    result.receipt.transactionHash,
                    result.receipt.status
                );
            });
        });
    });

    $("#transferBtn").click(function(e) {
        e.preventDefault();
        // input validation
        var transferTo = $("#transferTo").val();
        if (!transferTo) {
            $("#transferTo")
                .tooltip("hide")
                .attr("data-original-title", "Address can't be empty")
                .tooltip("show");
            disposeTooltip("#transferTo");
            return;
        }
        if (transferTo == "0" || transferTo == "0x0") {
            $("#transferTo")
                .tooltip("hide")
                .attr("data-original-title", "Address can't be zero")
                .tooltip("show");
            disposeTooltip("#transferTo");
            return;
        }

        var $this = $(this);
        var loadingText = '<i class="fa fa-spinner fa-spin"></i> Sending';
        if ($(this).html() !== loadingText) {
            $this.data("original-text", $(this).html());
            $this.html(loadingText);
        }
        setTimeout(function() {
            $this.html($this.data("original-text"));
        }, 3000);

        $("#transferBtn").prop("disabled", true);

        // add to activity
        let activity = {
            action: "Send",
            updatedAt: new Date().getTime(),
            status: "Pending",
            owner: owner
        };
        sendPostReq("/addactivity", activity, true, function(activityId) {
            console.log("Added activity");

            showSuccessAlert();
            $("#transfer").modal("hide");
            $("#transferBtn").prop("disabled", false);

            var data = {
                to: $("#transferTo").val(),
                owner: owner,
                tokenId: $("#tokenIdTransfer").val(),
                activityId: activityId
            };
            sendPostReq("/transfer", data, true, function(result) {
                console.log(
                    result.receipt.transactionHash,
                    result.receipt.status
                );
            });
        });
    });

    $("#sendBtn").click(function(e) {
        e.preventDefault();
        // input validation
        var sendTo = $("#sendTo").val();
        if (!sendTo) {
            $("#sendTo")
                .tooltip("hide")
                .attr("data-original-title", "Address can't be empty")
                .tooltip("show");
            disposeTooltip("#sendTo");
            return;
        }
        if (sendTo == "0" || sendTo == "0x0") {
            $("#sendTo")
                .tooltip("hide")
                .attr("data-original-title", "Address can't be zero")
                .tooltip("show");
            disposeTooltip("#sendTo");
            return;
        }
        var tokenId = $("#tokenId").val();
        if (!tokenId) {
            $("#tokenId")
                .tooltip("hide")
                .attr("data-original-title", "Token Id can't be empty")
                .tooltip("show");
            disposeTooltip("#tokenId");
            return;
        }

        var $this = $(this);
        var loadingText = '<i class="fa fa-spinner fa-spin"></i> Sending';
        if ($(this).html() !== loadingText) {
            $this.data("original-text", $(this).html());
            $this.html(loadingText);
        }
        setTimeout(function() {
            $this.html($this.data("original-text"));
        }, 3000);

        $("#sendBtn").prop("disabled", true);

        // add to activity
        let activity = {
            action: "Send",
            updatedAt: new Date().getTime(),
            status: "Pending",
            owner: owner
        };
        sendPostReq("/addactivity", activity, true, function(activityId) {
            console.log("Added activity");

            showSuccessAlert();
            $("#send").modal("hide");
            $("#sendBtn").prop("disabled", false);

            var data = {
                to: $("#sendTo").val(),
                owner: owner,
                tokenId: $("#tokenId").val(),
                activityId: activityId
            };
            sendPostReq("/transfer", data, true, function(result) {
                console.log(
                    result.receipt.transactionHash,
                    result.receipt.status
                );
            });
        });
    });
});

async function initNetwork() {
    try {
        let currentConfig = await db
            .collection("config")
            .doc("current")
            .get();
        let version = currentConfig.data().version;
        let config = await db
            .collection("config")
            .doc(version)
            .get();
        let configData = config.data();
        if (!rootRefSuffix || rootRefSuffix != configData.rootRefSuffix) {
            rootRefSuffix = configData.rootRefSuffix;
        }
        if (!explorer || explorer != configData.explorer) {
            explorer = configData.explorer;
        }
        console.log("Config read, using " + rootRefSuffix + " and " + explorer);
    } catch (err) {
        console.error("Error occured while reading config", err);
    }
}

function disposeTooltip(elem) {
    setTimeout(function() {
        $(elem).tooltip("dispose");
    }, 2000);
}

function isInt(value) {
    return (
        !isNaN(value) &&
        (function(x) {
            return (x | 0) === x;
        })(parseFloat(value))
    );
}

function showHome() {
    $("#navBarActivity").removeClass("active");
    $("#activityRoot").hide();
    $("#tokensList").hide();
    $("#tokensRoot").show();
    fetchTypes();
    $(this).addClass("active");
}

function showActivity() {
    $("#navBarTokens").removeClass("active");
    $("#tokensRoot").hide();
    $("#tokensList").hide();
    $("#activityRoot").show();
    fetchActivity();
    $(this).addClass("active");
}

function showSuccessAlert() {
    Swal.fire({
        type: "success",
        title: "Sent",
        text: "Request is sent. You can check the status in recent activity",
        customClass: {
            confirmButton: "swal-confirm-btn",
            title: "swal-title"
        }
    });
}

function sendPostReq(url, data, async, cb) {
    $.ajax({
        url: url,
        type: "POST",
        async: async,
        data: JSON.stringify(data),
        contentType: "application/json; charset=utf-8",
        success: function(result) {
            cb(result);
        },
        error: function(err) {
            console.error(err);
        }
    });
}

function sendGetReq(url, data, async, cb) {
    $.ajax({
        url: url,
        type: "GET",
        async: async,
        data: data,
        success: function(result) {
            cb(result);
        },
        error: function(err) {
            console.error(err);
        }
    });
}

function fetchTypes() {
    console.log("Fetching types for " + owner);
    $("#tokensRootBody").empty();
    //get types
    db.collection("types" + rootRefSuffix)
        .where("owner", "==", owner)
        .get()
        .then(snap => {
            if (snap.empty) {
                Swal.fire({
                    type: "warning",
                    title: "No NFTs found for " + owner,
                    customClass: {
                        confirmButton: "swal-confirm-btn",
                        title: "swal-title"
                    }
                });
                $("#create").modal("show");
                return;
            }

            $("#welcomeDiv").hide();

            let num = snap.docs.length;
            let dispStr;
            if (num == 1) {
                dispStr = "You have 1 NFT type";
            } else {
                dispStr = "You have " + num + " NFT types";
            }
            $("#tokensRootHeader").html(dispStr);
            for (var i = 0; i < num; i++) {
                // add a row for every 3 types
                if (i % 3 == 0) {
                    var row = $("<div>", {
                        class: "row",
                        id: "tokensRootRow" + i / 3
                    });
                    $("#tokensRootBody").append(row);
                    $("#tokensRootBody").append("<br>");
                }
                var rowId = "#tokensRootRow" + Math.floor(i / 3);
                var nft = snap.docs[i].data();
                var col = $("<div>", { class: "col-4" });
                var card = $("<div>", { class: "card nft-card" });

                let imgSrc;
                if (nft.uri) {
                    imgSrc = nft.uri;
                } else {
                    let suffix = i % 7; // 7 because plaeholder images are numbered 0 to 6
                    imgSrc = "/img/ph" + suffix + ".png";
                }
                var cardImg = $("<img>", {
                    class: "card-img-top nft-card-img",
                    src: imgSrc
                });
                //attach click listener to image
                cardImg.click(function() {
                    let type = $(this)
                        .siblings("div")
                        .children("h5:first")
                        .html();
                    state.view = "tokens";
                    state.type = type;
                    window.history.pushState(state, null, "");
                    fetchTokens(type);
                });
                card.append(cardImg);

                var cardBody = $("<div>", { class: "card-body" });
                var cardTitle = $("<h5>", { class: "card-title" });
                cardTitle.append(nft.name);
                cardBody.append(cardTitle);

                var cardText = $("<p>", {
                    class: "card-text",
                    style: "color:gray"
                });
                cardText.append(nft.symbol + "<br><br>");
                cardText.append("Id: " + nft.type);
                cardBody.append(cardText);

                var mintLink = $("<a>", { class: "card-link", href: "#" });
                mintLink.append("Mint");
                mintLink.click(function(e) {
                	e.preventDefault();
                    e.stopPropagation();
                    let name = $(this)
                        .siblings("h5")
                        .html();
                    $("#mintName").val(name);
                    $("#mint").modal("show");
                });

                var claimLink = $("<a>", { class: "card-link", href: "#" });
                claimLink.append("Claim");
                claimLink.click(function(e) {
                	e.preventDefault();
                    e.stopPropagation();
                    let name = $(this)
                        .siblings("h5")
                        .html();
                    $("#claimName").val(name);
                    $("#claim").modal("show");
                });

                var uriLink = $("<a>", { class: "card-link", href: "#" });
                uriLink.append("Set image");
                uriLink.click(function(e) {
                	e.preventDefault();
                    e.stopPropagation();
                    // in the form of <name><br>Id: <number>
                    let tokenId = $(this)
                        .siblings("p")
                        .html();
                    tokenId = tokenId.split(" ")[1];
                    let type = $(this)
                        .siblings("h5")
                        .html();
                    $("#tokenIdUri").val(tokenId);
                    $("#typeUri").val(type);
                    $("#setUri").modal("show");
                });

                cardBody.append(mintLink);
                cardBody.append(claimLink);
                cardBody.append(uriLink);

                card.append(cardBody);

                col.append(card);
                $(rowId).append(col);
            }
        })
        .catch(err => {
            console.error("Error fetching types", err);
        });
}

function fetchTokens(type) {
    console.log("Fetching tokens for type " + type);
    $("#activityRoot").hide();
    $("#tokensRoot").hide();
    $("#tokensList").show();
    $("#tokensBody").empty();

    db.collection("tokens" + rootRefSuffix)
        .where("owner", "==", owner)
        .where("name", "==", type)
        .get()
        .then(snap => {
            if (snap.empty) {
                $("#tokensListHeader").html("You don't have any " + type + "s");
                return;
            }
            let num = snap.docs.length;
            let dispStr;
            if (num == 1) {
                dispStr = "You have 1 " + type;
            } else {
                dispStr = "You have " + num + " " + type + "s";
            }
            $("#tokensListHeader").html(dispStr);
            for (var i = 0; i < num; i++) {
                var nft = snap.docs[i].data();
                // add a row for every 3 types
                if (i % 3 == 0) {
                    var row = $("<div>", {
                        class: "row",
                        id: "tokensListRow" + i / 3
                    });
                    $("#tokensBody").append(row);
                    $("#tokensBody").append("<br>");
                }
                var rowId = "#tokensListRow" + Math.floor(i / 3);
                var col = $("<div>", { class: "col-4" });
                var card = $("<div>", { class: "card token-card" });

                let imgSrc;
                if (nft.uri) {
                    imgSrc = nft.uri;
                } else {
                    let suffix = i % 7; // 7 because plaeholder images are numbered 1 to 6
                    imgSrc = "/img/ph" + suffix + ".png";
                }
                var cardImg = $("<img>", {
                    class: "card-img-top",
                    src: imgSrc
                });
                card.append(cardImg);

                var cardBody = $("<div>", { class: "card-body" });

                var cardText = $("<p>", {
                    class: "card-text",
                    style: "color:black"
                });
                cardText.append("Token Id: " + nft.tokenId);
                cardBody.append(cardText);

                var sendLink = $("<a>", { class: "card-link", href: "#" });
                sendLink.append("Send");
                sendLink.click(function(e) {
                	e.preventDefault();
                    e.stopPropagation();
                    // in the form of Token Id: <number>
                    let tokenId = $(this)
                        .siblings("p")
                        .html();
                    tokenId = tokenId.split(" ")[2];
                    $("#tokenIdTransfer").val(tokenId);
                    $("#transfer").modal("show");
                });

                var uriLink = $("<a>", { class: "card-link", href: "#" });
                uriLink.append("Set Image");
                uriLink.click(function(e) {
                	e.preventDefault();
                    e.stopPropagation();
                    // in the form of Token Id: <number>
                    let tokenId = $(this)
                        .siblings("p")
                        .html();
                    tokenId = tokenId.split(" ")[2];
                    $("#tokenIdUri").val(tokenId);
                    $("#typeUri").val("___token___");
                    $("#setUri").modal("show");
                });

                cardBody.append(sendLink);
                cardBody.append(uriLink);

                card.append(cardBody);
                col.append(card);
                $(rowId).append(col);
            }
        })
        .catch(err => {
            console.error("Error fetching tokens", err);
        });
}

function fetchActivity() {
    $('#activityBody').empty();
    console.log("Fetching activity for " + owner);
    db.collection("activity" + rootRefSuffix)
        .where("owner", "==", owner)
        .orderBy("updatedAt", "desc")
        .limit(50)
        .get()
        .then(snap => {
            for (var i = 0; i < snap.docs.length; i++) {
                var activity = snap.docs[i].data();
                var tr = $("<tr>");
                var th = $("<th>", { scope: "row" });
                th.append(i + 1);

                var statusStr;
                if (activity.status == "Pending") {
                    statusStr = "<td style='color:orange'>Pending</td>";
                } else if (activity.status == true) {
                    statusStr = "<td style='color:green'>Success</td>";
                } else if (activity.status == false) {
                    statusStr = "<td style='color:red'>Failed</td>";
                } else {
                    statusStr = "<td>N/A</td>";
                }

                var txStr;
                if (activity.tx) {
                    txStr =
                        "<td><a target='_blank' href=" +
                        explorer +
                        activity.tx +
                        ">" +
                        activity.tx +
                        "</a></td>";
                } else {
                    txStr = "<td>N/A</td>";
                }

                var dateStr = new Date(activity.updatedAt).toLocaleString();
                var cols =
                    "<td>" +
                    activity.action +
                    "</td>" +
                    statusStr +
                    txStr +
                    "<td>" +
                    dateStr +
                    "</td>";
                tr.append(th);
                tr.append(cols);
                $("#activityBody").append(tr);
            }
        })
        .catch(err => {
            console.error("Error fetching activity", err);
        });
}