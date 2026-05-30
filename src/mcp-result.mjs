function makeResult(payload) {
  return {
    content: [
      {
        type: "json",
        json: payload,
      },
    ],
  };
}

export { makeResult };
