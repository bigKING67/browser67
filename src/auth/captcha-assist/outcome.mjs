function assistBlocked(plan, reason, extras = {}) {
  return {
    ...plan,
    status: "blocked",
    action: "assist_captcha",
    reason,
    executed: false,
    ...extras,
  };
}

export {
  assistBlocked,
};
