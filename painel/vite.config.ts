import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./" permite publicar em qualquer subcaminho (Vercel, Netlify, GitHub Pages...).
export default defineConfig({ plugins: [react()], base: "./" });
