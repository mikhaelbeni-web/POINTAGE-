// Permet à Node de charger les fichiers de src/ importés sans extension (comme le fait Next.js).
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    try { return await next(spec, ctx); }
    catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && spec.startsWith(".") && !spec.endsWith(".js")) return next(spec + ".js", ctx); throw e; }
  }`));
