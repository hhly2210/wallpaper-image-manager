-- Initialize database for Wallpaper Image Manager
-- This file runs when the PostgreSQL container starts for the first time

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Set default timezone
SET timezone = 'UTC';

-- You can add any initial data or schema customizations here
-- For example:
-- INSERT INTO your_table (column1, column2) VALUES ('value1', 'value2');