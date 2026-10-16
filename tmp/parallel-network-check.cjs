const hosts = ['tob-upload-mya-d.byteplusvodupload.com', 'tob-upload-myb-d.byteplusvodupload.com'];
(async () => {
  for (const host of hosts) {
    const started = Date.now();
    try {
      const response = await fetch(`https://${host}/`, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      console.log(JSON.stringify({ host, status: response.status, ms: Date.now() - started }));
    } catch (error) {
      console.log(JSON.stringify({ host, error: error.message, cause: error.cause?.code ?? error.cause?.message, ms: Date.now() - started }));
    }
  }
})();
