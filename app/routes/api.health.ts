import type { LoaderFunctionArgs } from "react-router";
import { json } from "react-router";
import db from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Simple database health check using native query
    await db.$queryRaw`SELECT 1`;

    return json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
      environment: process.env.NODE_ENV || "development",
      app: "wallpaper-image-manager"
    });
  } catch (error) {
    console.error("Health check failed:", error);

    return json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
        app: "wallpaper-image-manager"
      },
      { status: 503 }
    );
  }
}