function firstJsonContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (item?.type === "json" && typeof item.json === "object" && item.json !== null) {
      return item.json;
    }
  }
  return null;
}

export {
  firstJsonContent
};
