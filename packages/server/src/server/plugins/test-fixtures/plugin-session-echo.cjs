process.on("message", (message) => {
  if (message?.type !== "rambla_frame") return;
  process.send?.(message);
});
