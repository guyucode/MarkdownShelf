import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,use:{baseURL:'http://localhost:1430',launchOptions:{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH},viewport:{width:1280,height:840}},webServer:{command:'pnpm dev',url:'http://localhost:1430',reuseExistingServer:false},reporter:'list'});
