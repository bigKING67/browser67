function makeJsonTextContent(payload) {
  return {
    type: "text",
    text: JSON.stringify(payload),
  };
}

function makeResult(payload) {
  return {
    content: [
      makeJsonTextContent(payload),
    ],
  };
}

export { makeJsonTextContent, makeResult };
