import { createCuiApiApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const app = await createCuiApiApp();

app.listen(port, () => {
  console.log(`CUI Companion API listening on http://localhost:${port}`);
});
