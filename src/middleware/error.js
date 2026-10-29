function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(err, req, res, next) {
  console.error(err);

  if (err.code === "23505") {
    return res.status(409).json({ success: false, message: "Duplicate record" });
  }

  if (err.code === "23503") {
    return res.status(400).json({ success: false, message: "Related record does not exist" });
  }

  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: status === 500 ? "Internal server error" : err.message,
  });
}

module.exports = { notFound, errorHandler };
