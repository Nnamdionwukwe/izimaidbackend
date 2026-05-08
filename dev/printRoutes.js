// dev/printRoutes.js
import app from "../src/app.js"; // <-- Path to where Express app is created

function print(path, layer) {
  if (layer.route) {
    const routePath = path + layer.route.path;
    const methods = Object.keys(layer.route.methods).join(", ").toUpperCase();
    console.log(`${methods}  ${routePath}`);
  } else if (layer.name === "router" && layer.handle.stack) {
    layer.handle.stack.forEach((nested) =>
      print(
        path +
          (layer.regexp.source === "^\\/?$"
            ? ""
            : layer.regexp.source
                .replace(/\\\//g, "/")
                .replace("^", "")
                .replace("?$", "")),
        nested,
      ),
    );
  }
}

console.log("\n================ ROUTES =================\n");
app._router.stack.forEach((layer) => print("", layer));
console.log("\n==========================================\n");
process.exit(0);
