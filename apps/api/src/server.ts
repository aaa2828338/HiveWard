import { createHivewardApiApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const app = await createHivewardApiApp();

app.listen(port, () => {
  console.log(`Hiveward API listening on http://localhost:${port}`);
});
