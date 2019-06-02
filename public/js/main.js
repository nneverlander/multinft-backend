var db;
var rootRefSuffix = "-ropsten";
var owner = localStorage.getItem('owner');
var etherscan = "https://ropsten.etherscan.io/tx/";
var activityFetched = false;

$(function(){

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

  // claim button disabled by default
  $('#claimBtn').prop('disabled', true);
  // owner field in create hidden by default
  $('#createOwnerDiv').hide();
  //activity hidden by default
  $('#activityRoot').hide();
  $('#tokensList').hide();

  if (!owner) {
  	console.log("No owner in local storage");
	$('#createOwnerDiv').show();
	$('#welcome').modal('show');
  } else {
  	fetchTypes();
  }

  $('#navBarTokens').on('click', function () {
	showHome();
  });

  $('#logo').on('click', function () {
	showHome();
  });

  $('#navBarActivity').on('click', function () {
	$('#navBarTokens').removeClass('active');
	$('#tokensRoot').hide();
	$('#tokensList').hide();
	$('#activityRoot').show();
	fetchActivity();
	$(this).addClass('active');
  });

  $("#welcomeFetch").click(function () {
	  	$('#welcome').modal('hide');
		owner = $("#welcomeOwner").val();
		localStorage.setItem('owner', owner);
		$('#createOwnerDiv').hide();
		fetchTypes();
  });

  $("#createBtn").click(function () {
		var $this = $(this);
	    var loadingText = '<i class="fa fa-spinner fa-spin"></i> Creating';
	    if ($(this).html() !== loadingText) {
	      $this.data('original-text', $(this).html());
	      $this.html(loadingText);
	    }
	    setTimeout(function() {
	      $this.html($this.data('original-text'));
	    }, 3000);

  		$('#welcome').modal('hide');

	  	if (!owner) {
	  		owner = $("#owner").val();
	  		localStorage.setItem("owner", owner);
	  		console.log("New owner " + owner + " set");
	  	}

	  	$('#createBtn').prop('disabled', true);

		var data = {
			name: $("#name").val(),
			symbol: $("#symbol").val()
		}
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
				  type: 'error',
				  title: 'NFT exists',
				  text: message + ' exists',
				  customClass: {
				  	confirmButton: 'swal-confirm-btn',
				  	title: 'swal-title'
				  }
				});
				$('#createBtn').prop('disabled', false);
			} else {
				// add to activity
				let activity = {
					action: "Create NFT",
					updatedAt: new Date().getTime(),
					status: "Pending",
					owner: owner
				}
				sendPostReq("/addactivity", activity, true, function(activityId) {
					console.log("Added activity");

					showSuccessAlert();
					$('#createOwnerDiv').hide();
					$('#create').modal('hide');
					$('#createBtn').prop('disabled', false);

					// call create
					data.owner = owner;
					data.uri = "";
					data.activityId = activityId;
					sendPostReq("/create", data, true, function(createResult) {
						console.log(createResult.receipt.transactionHash, createResult.receipt.status);
					});
				});
			}
		});
  	});

  	$("#mintBtn").click(function () {
  		var $this = $(this);
	    var loadingText = '<i class="fa fa-spinner fa-spin"></i> Minting';
	    if ($(this).html() !== loadingText) {
	      $this.data('original-text', $(this).html());
	      $this.html(loadingText);
	    }
	    setTimeout(function() {
	      $this.html($this.data('original-text'));
	    }, 3000);

	    $('#mintBtn').prop('disabled', true);

		// add to activity
		let activity = {
			action: "Mint tokens",
			updatedAt: new Date().getTime(),
			status: "Pending",
			owner: owner
		}
		sendPostReq("/addactivity", activity, true, function(activityId) {
			console.log("Added activity");

			showSuccessAlert();
			$('#mint').modal('hide');
			$('#mintBtn').prop('disabled', false);

			// call mint
			var data = {
				name: $("#mintName").val(),
				count: $("#mintCount").val(),
				uri: "",
				owner: owner,
				activityId: activityId
			}
			sendPostReq("/mint", data, true, function(result) {
				console.log(result.receipt.transactionHash, result.receipt.status);
			});
		});
    });

    $("#claimBtn").click(function () {
  		var $this = $(this);
	    var loadingText = '<i class="fa fa-spinner fa-spin"></i> Claiming';
	    if ($(this).html() !== loadingText) {
	      $this.data('original-text', $(this).html());
	      $this.html(loadingText);
	    }
	    setTimeout(function() {
	      $this.html($this.data('original-text'));
	    }, 3000);

	    $('#claimBtn').prop('disabled', true);

		// add to activity
		let activity = {
			action: "Claim NFT",
			updatedAt: new Date().getTime(),
			status: "Pending",
			owner: owner
		}
		sendPostReq("/addactivity", activity, true, function(activityId) {
			console.log("Added activity");

			showSuccessAlert();
			$('#claim').modal('hide');
			$('#claimBtn').prop('disabled', false);

			var data = {
				name: $("#claimName").val(),
				oldOwner: owner,
				newOwner: $("#claimAddr").val(),
				activityId: activityId
			}
			sendPostReq("/claim", data, true, function(result) {
				console.log(result.receipt.transactionHash, result.receipt.status);
			});
		});
    });

    $("#setUriBtn").click(function () {
  		var $this = $(this);
	    var loadingText = '<i class="fa fa-spinner fa-spin"></i> Setting';
	    if ($(this).html() !== loadingText) {
	      $this.data('original-text', $(this).html());
	      $this.html(loadingText);
	    }
	    setTimeout(function() {
	      $this.html($this.data('original-text'));
	    }, 3000);

	    $('#setUriBtn').prop('disabled', true);

		// add to activity
		let activity = {
			action: "Set URI",
			updatedAt: new Date().getTime(),
			status: "Pending",
			owner: owner
		}
		sendPostReq("/addactivity", activity, true, function(activityId) {
			console.log("Added activity");

			showSuccessAlert();
			$('#setUri').modal('hide');
			$('#setUriBtn').prop('disabled', false);

			var data = {
				tokenId: $("#tokenIdUri").val(),
				owner: owner,
				uri: $("#uriInput").val(),
				type: $("#typeUri").val(),
				activityId: activityId
			}
			sendPostReq("/seturi", data, true, function(result) {
				console.log(result.receipt.transactionHash, result.receipt.status);
			});
		});
    });

    $("#transferBtn").click(function () {
  		var $this = $(this);
	    var loadingText = '<i class="fa fa-spinner fa-spin"></i> Sending';
	    if ($(this).html() !== loadingText) {
	      $this.data('original-text', $(this).html());
	      $this.html(loadingText);
	    }
	    setTimeout(function() {
	      $this.html($this.data('original-text'));
	    }, 3000);

	    $('#transferBtn').prop('disabled', true);

		// add to activity
		let activity = {
			action: "Send",
			updatedAt: new Date().getTime(),
			status: "Pending",
			owner: owner
		}
		sendPostReq("/addactivity", activity, true, function(activityId) {
			console.log("Added activity");

			showSuccessAlert();
			$('#transfer').modal('hide');
			$('#transferBtn').prop('disabled', false);

			var data = {
				to: $("#transferTo").val(),
				owner: owner,
				tokenId: $("#tokenIdTransfer").val(),
				activityId: activityId
			}
			sendPostReq("/transfer", data, true, function(result) {
				console.log(result.receipt.transactionHash, result.receipt.status);
			});
		});
    });

    $("#sendBtn").click(function () {
  		var $this = $(this);
	    var loadingText = '<i class="fa fa-spinner fa-spin"></i> Sending';
	    if ($(this).html() !== loadingText) {
	      $this.data('original-text', $(this).html());
	      $this.html(loadingText);
	    }
	    setTimeout(function() {
	      $this.html($this.data('original-text'));
	    }, 3000);

	    $('#sendBtn').prop('disabled', true);

		// add to activity
		let activity = {
			action: "Send",
			updatedAt: new Date().getTime(),
			status: "Pending",
			owner: owner
		}
		sendPostReq("/addactivity", activity, true, function(activityId) {
			console.log("Added activity");

			showSuccessAlert();
			$('#send').modal('hide');
			$('#sendBtn').prop('disabled', false);

			var data = {
				to: $("#sendTo").val(),
				owner: owner,
				tokenId: $("#tokenId").val(),
				activityId: activityId
			}
			sendPostReq("/transfer", data, true, function(result) {
				console.log(result.receipt.transactionHash, result.receipt.status);
			});
		});
    });

});

function showHome() {
	$('#navBarActivity').removeClass('active');
	$('#activityRoot').hide();
	$('#tokensList').hide();
	$('#tokensRoot').show();
	$(this).addClass('active');
}

function showSuccessAlert() {
	Swal.fire({
	  type: 'success',
	  title: 'Sent',
	  text: 'Request is sent. You can check the status in recent activity',
	  customClass: {
	  	confirmButton: 'swal-confirm-btn',
	  	title: 'swal-title'
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
	  	console.log(err);
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
	//get types
	db.collection("types" + rootRefSuffix).where('owner', '==', owner).get().then(snap => {
		if (snap.empty) {
			$('#create').modal('show');
			return;
		}
		$("#tokensRootHeader").html("You have " + snap.docs.length + " types of NFTs");
		for (var i = 0; i < snap.docs.length; i++) {
			// add a row for every 2 types
			if (i % 2 == 0) {
				var row = $("<div>", {class: "row", id: "tokensRootRow" + i/2});
				$('#tokensRoot').append(row);
				$('#tokensRoot').append("<br>");
			}
			var rowId = "#tokensRootRow" + Math.floor(i/2);
			var nft = snap.docs[i].data();
			var col = $("<div>", {class: "col-6"});
			var card = $("<div>", {class: "card nft-card"});
			if (nft.uri) {
				var cardImg = $("<img>", {class: "card-img-top", src: nft.uri});
				card.append(cardImg);
			}
			var cardBody = $("<div>", {class: "card-body"});
			var cardTitle = $("<h5>", {class: "card-title"});
			cardTitle.append(nft.name);
			cardBody.append(cardTitle);

			var cardText = $("<p>", {class: "card-text", style: "color:gray"});
			cardText.append(nft.symbol + "<br><br>");
			cardText.append("Id: " + nft.type);
			cardBody.append(cardText);

			var mintLink = $("<a>", {class: "card-link", href:"#"});
			mintLink.append("Mint");
			mintLink.click(function(e) {
				e.stopPropagation();
				let name = $(this).siblings("h5").html();
				$('#mintName').val(name);
				$('#mint').modal('show');
			});

			var claimLink = $("<a>", {class: "card-link", href:"#"});
			claimLink.append("Claim");
			claimLink.click(function(e) {
				e.stopPropagation();
				let name = $(this).siblings("h5").html();
				$('#claimName').val(name);
				$('#claim').modal('show');
			});

			var uriLink = $("<a>", {class: "card-link", href:"#"});
			uriLink.append("SetURI");
			uriLink.click(function(e) {
				e.stopPropagation();
				// in the form of <name><br>Id: <number>
				let tokenId = $(this).siblings("p").html();
				tokenId = tokenId.split(" ")[1];
				let type = $(this).siblings("h5").html();
				$('#tokenIdUri').val(tokenId);
				$('#typeUri').val(type);
				$('#setUri').modal('show');
			});

			cardBody.append(mintLink);
			cardBody.append(claimLink);
			cardBody.append(uriLink);
			
			card.append(cardBody);

			//attach click listener
			card.click(function() {
				let name = $(this).find("h5").html();
				fetchTokens(name);
			});

			col.append(card);
			$(rowId).append(col);
		}
    }).catch(err => {
    	console.error("Error fetching types", err);
    });
}

function fetchTokens(type) {
	console.log("Fetching tokens for type" + type);
	$('#tokensRoot').hide();
	$('#tokensList').show();
	$('#tokensBody').empty();

	db.collection("tokens" + rootRefSuffix).where('owner', '==', owner).where('name', '==', type).get().then(snap => {
		if (snap.empty) {
			$("#tokensListHeader").html("You don't have any " + type + "s");
			return;
		}
		$("#tokensListHeader").html("You have " + snap.docs.length + " " + type + "s");
		for (var i = 0; i < snap.docs.length; i++) {
			var nft = snap.docs[i].data();
			// add a row for every 3 types
			if (i % 3 == 0) {
				var row = $("<div>", {class: "row", id: "tokensListRow" + i/3});
				$('#tokensBody').append(row);
				$('#tokensBody').append("<br>");
			}
			var rowId = "#tokensListRow" + Math.floor(i/3);
			var col = $("<div>", {class: "col-4"});
			var card = $("<div>", {class: "card token-card"});

			if (nft.uri) {
				var cardImg = $("<img>", {class: "card-img-top", src: nft.uri});
				card.append(cardImg);
			}
			var cardBody = $("<div>", {class: "card-body"});

			var cardText = $("<p>", {class: "card-text", style: "color:black"});
			cardText.append("Token Id: " + nft.tokenId);
			cardBody.append(cardText);

			var sendLink = $("<a>", {class: "card-link", href:"#"});
			sendLink.append("Send");
			sendLink.click(function(e) {
				e.stopPropagation();
				// in the form of Token Id: <number>
				let tokenId = $(this).siblings("p").html();
				tokenId = tokenId.split(" ")[2];
				$('#tokenIdTransfer').val(tokenId);
				$('#transfer').modal('show');
			});

			var uriLink = $("<a>", {class: "card-link", href:"#"});
			uriLink.append("SetURI");
			uriLink.click(function(e) {
				e.stopPropagation();
				// in the form of Token Id: <number>
				let tokenId = $(this).siblings("p").html();
				tokenId = tokenId.split(" ")[2];
				$('#tokenIdUri').val(tokenId);
				$('#typeUri').val("___token___");
				$('#setUri').modal('show');
			});

			cardBody.append(sendLink);
			cardBody.append(uriLink);
			
			card.append(cardBody);
			col.append(card);
			$(rowId).append(col);
		}
    }).catch(err => {
    	console.error("Error fetching tokens", err);
    });
}

function fetchActivity() {
	if (activityFetched) {
		return;
	}
	console.log("Fetching activity for " + owner);
	db.collection("activity" + rootRefSuffix).where("owner", "==", owner).orderBy('updatedAt', 'desc').limit(50).get().then(snap => {
		activityFetched = true;
		for (var i = 0; i < snap.docs.length; i++) {
			var activity = snap.docs[i].data();
			var tr = $("<tr>");
			var th = $("<th>", {scope: "row"});
			th.append(i+1);

			var statusStr;
			if (activity.status == "Pending") {
				statusStr = "<td style='color:orange'>Pending</td>"
			} else if (activity.status == true) {
				statusStr = "<td style='color:green'>Success</td>"
			} else if (activity.status == false) {
				statusStr = "<td style='color:red'>Failed</td>"
			} else {
				statusStr = "<td>N/A</td>"
			}

			var txStr;
			if (activity.tx) {
				txStr = "<td><a target='_blank' href=" + etherscan + activity.tx + ">" + activity.tx + "</a></td>"
			} else {
				txStr = "<td>N/A</td>"
			}

			var dateStr = new Date(activity.updatedAt).toLocaleString();
			var cols = "<td>" + activity.action + "</td>" + statusStr + txStr + "<td>" + dateStr + "</td>";
			tr.append(th);
			tr.append(cols);
			$('#activityBody').append(tr);
		}
    }).catch(err => {
    	console.error("Error fetching activity", err);
    });
}