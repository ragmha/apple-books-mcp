#!/usr/bin/env bun
import { serve } from "./server.ts";

serve().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
