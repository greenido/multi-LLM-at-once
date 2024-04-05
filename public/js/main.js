
const chatLog1 = document.getElementById("chat-log-1");
const chatLog2 = document.getElementById("chat-log-2");
const queryInput = document.getElementById("chat-input");
const sendQueryBtn = document.getElementById("send-query-btn");
const contextInput = document.getElementById("context-input");
const setContextBtn = document.getElementById("set-context-btn");

// Function to listen to Enter key
function listentoEneter(inputElement, buttonElement) {
  inputElement.addEventListener("keyup", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      buttonElement.click();
    }
  });
}
listentoEneter(queryInput, sendQueryBtn);
listentoEneter(contextInput, setContextBtn);

//
sendQueryBtn.addEventListener("click", async () => {
  const query = queryInput.value.trim();
  if (query) {
    appendMessage("Me", query, chatLog1);
    appendMessage("Me", query, chatLog2);
    queryInput.value = "";

    // Send the query to the server for LLAME2
    try {
      toggleSpinner(document.getElementById("spinner"));
      const response = await fetch("/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();
      toggleSpinner(document.getElementById("spinner"));
      if (data.response) {
        appendMessage("AI", data.response, chatLog1);
      } else {
        appendMessage("Error", data.response, chatLog1);
      }
    } catch (error) {
      appendMessage("Error", "An error occurred", chatLog1);
      console.error("Error:", error);
    }

    // Send the query to the server for MISTRAL
    try {
      toggleSpinner(document.getElementById("spinner-mistral"));
      const response = await fetch("/query2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      const data2 = await response.json();
      toggleSpinner(document.getElementById("spinner-mistral"));
      if (data2.response) {
        appendMessage("AI", data2.response, chatLog2);
      } else {
        appendMessage("Error", data2.response, chatLog2);
      }
    } catch (error) {
      appendMessage("Error", "An error occurred", chatLog2);
      console.error("Error:", error);
    }
  }
});

setContextBtn.addEventListener("click", () => {
  const context = contextInput.value.trim();
  fetch("/set-context", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `context=${encodeURIComponent(context)}`,
  })
    .then(() => {
      //window.location.reload();
      console.log("Context updated: " + context);
    })
    .catch((error) => {
      console.error("Error:", error);
    });
});

// Utility function to toggle the spinner off/on while we working on the request
function toggleSpinner(spinner) {
  spinner.classList.toggle("d-none");
}

// Utility function to append a message to the chat log
function appendMessage(sender, message, chatLog) {
  //const messageElement = document.createElement("div");
  let messageElement = `* ${sender}: ${message.trim()}\n`;
  chatLog.value += messageElement + "----\n";
  chatLog.scrollTop = chatLog.scrollHeight;
}

// utility function to copy text to clipboard
function copyToClipboard(element) {
  const textToCopy = element.value;
  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      console.log("Text copied to clipboard!");
    })
    .catch((err) => {
      console.error("Failed to copy text:", err);
    });
}

// copy both chat logs to clipboard
function copyAllToClipboard() {
  const textToCopy = 'LLAMA2:\n' + chatLog1.value + '\n=====\nMistral:\n' + chatLog2.value;
  navigator.clipboard
    .writeText(textToCopy)
    .then(() => {
      console.log("ALL Text copied to clipboard!");
    })
    .catch((err) => {
      console.error("Failed to copy ALL text:", err);
    });
}

// utility function to export text area content
function exportTextarea() {
  const textareaContent = 'LLAMA2:\n' + chatLog1.value + '\n=====\nMistral:\n' + chatLog2.value;
  const textFile = new Blob([textareaContent], { type: "text/plain" });
  const downloadLink = document.createElement("a");
  const currentDateTime = new Date().toISOString();
  downloadLink.download = "exported_multi-llm_" + currentDateTime + ".txt";
  downloadLink.href = window.URL.createObjectURL(textFile);
  downloadLink.click();
}

//
// Start the party
// Listen to copy button
//
$(document).ready(function () {
  $(".m-copy-btn").click(function () {
    copyToClipboard(chatLog2);
  });
  $(".llame-copy-btn").click(function () {
    copyToClipboard(chatLog1);
  });
});