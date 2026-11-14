// served from loopback: marks the page so the snapshot shows the script ran
const p = document.createElement("p");
p.textContent = "ok.js loaded";
document.querySelector("main").appendChild(p);
