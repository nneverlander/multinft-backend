$(function(){

  var owner = localStorage.getItem('owner');
  if (!owner) {
  	console.log("No owner in local storage");
  	$('#welcome').modal('show');
  } else {
  	fetchTokens(owner);
  }

  $("#welcomeFetch").click(function () {
	owner = $("#welcomeOwner").val();
	localStorage.setItem('owner', owner);
	fetchTokens(owner);
  });

});

function fetchTokens(owner) {
	console.log("fetching tokens for " + owner);
}