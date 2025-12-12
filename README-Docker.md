# Docker Development Setup

This document explains how to set up and run the Wallpaper Image Manager using Docker.

## Prerequisites

- Docker Desktop installed and running
- Git

## Quick Start

1. **Start all services:**
   ```bash
   npm run docker:dev
   ```

2. **Wait for services to be ready** (may take 2-3 minutes on first run)

3. **Access your services:**
   - App: http://localhost:3000
   - Prisma Studio: http://localhost:5555
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

## Available Docker Commands

```bash
# Start development environment
npm run docker:dev          # Start with logs
npm run docker:dev-d        # Start in background

# Stop services
npm run docker:down         # Stop and remove containers

# View logs
npm run docker:logs         # Follow logs from all services

# Clean everything (including data)
npm run docker:clean        # Remove containers, volumes, and networks

# Database operations
npm run docker:db:migrate   # Run Prisma migrations
npm run docker:db:studio    # Open Prisma Studio
npm run docker:db:reset     # Reset database
```

## Services Included

### 🐘 PostgreSQL Database
- **Port:** 5432
- **Database:** wallpaper_db
- **Username:** postgres
- **Password:** password
- **Data persistence:** Yes (via Docker volume)

### 🔴 Redis Cache
- **Port:** 6379
- **Data persistence:** Yes (via Docker volume)
- **Purpose:** Caching and session storage

### 🚀 Application
- **Port:** 3000
- **Environment:** Development
- **Hot reload:** Yes
- **Health check:** Yes

### 🛠️ Prisma Studio
- **Port:** 5555
- **Access:** http://localhost:5555
- **Purpose:** Database management GUI

## Environment Variables

The Docker setup automatically configures these variables:

```env
PRISMA_DATABASE_URL=postgresql://postgres:password@postgres:5432/wallpaper_db?schema=public
DATABASE_URL=postgresql://postgres:password@postgres:5432/wallpaper_db?schema=public
NODE_ENV=development
PORT=3000
```

## Troubleshooting

### Port Already in Use
If you get port conflicts, change the ports in `docker-compose.yml`:

```yaml
ports:
  - "3001:3000"  # Use 3001 instead of 3000
```

### Database Connection Issues
1. Make sure PostgreSQL container is healthy:
   ```bash
   docker-compose ps
   ```

2. Check PostgreSQL logs:
   ```bash
   docker-compose logs postgres
   ```

3. Reset database:
   ```bash
   npm run docker:db:reset
   ```

### Migration Issues
If migrations fail:

1. Access the app container:
   ```bash
   docker-compose exec app sh
   ```

2. Run migrations manually:
   ```bash
   npx prisma migrate dev
   ```

3. Exit container:
   ```bash
   exit
   ```

### Performance Issues
- **First build:** May take 5-10 minutes
- **Subsequent builds:** Much faster (1-2 minutes)
- **Hot reload:** Code changes reflect immediately

## Production Deployment

For production deployment to Vercel:

1. **Build the image:**
   ```bash
   docker build -f Dockerfile -t wallpaper-app .
   ```

2. **Configure environment variables in Vercel:**
   - `DATABASE_URL`
   - `PRISMA_DATABASE_URL`
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_GOOGLE_CLIENT_SECRET`

3. **Deploy to Vercel:**
   ```bash
   npm run deploy
   ```

## Development Workflow

1. **Make code changes** → Auto hot reload
2. **Database schema changes** → Run `npm run docker:db:migrate`
3. **View data** → Open http://localhost:5555 (Prisma Studio)
4. **View logs** → Run `npm run docker:logs`

## Architecture

```
┌─────────────────┐    ┌─────────────────┐
│   Your Browser  │◄──►│   App Container │
│  localhost:3000 │    │  (React Router) │
└─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │  PostgreSQL     │
                       │  (port 5432)    │
                       └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │     Redis       │
                       │  (port 6379)    │
                       └─────────────────┘
```

## Support

If you encounter issues:

1. Check Docker Desktop is running
2. Verify no port conflicts
3. Run `npm run docker:logs` to see error messages
4. Try `npm run docker:clean` then `npm run docker:dev`