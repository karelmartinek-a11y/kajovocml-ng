import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{target:'es2024',outDir:'dist',sourcemap:true,assetsDir:'assets'},server:{port:4173,proxy:{'/api':{target:'http://localhost:4080',changeOrigin:false},'/health':{target:'http://localhost:4080'}}}});
