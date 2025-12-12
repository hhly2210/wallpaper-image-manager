# Podman Development Setup

This document explains how to set up and run the Wallpaper Image Manager using Podman.

## Prerequisites

- Podman installed and running (✅ You have Podman 5.7.0)
- podman-compose installed (✅ Just installed)
- Git

## Quick Start

1. **Start all services:**
   ```bash
   npm run podman:dev
   ```

2. **Wait for services to be ready** (may take 2-3 minutes on first run)

3. **Access your services:**
   - App: http://localhost:3000
   - Prisma Studio: http://localhost:5555
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379

## Available Podman Commands

```bash
# Start development environment
npm run podman:dev        # Start with logs
npm run podman:dev-d      # Start in background

# Stop services
npm run podman:down       # Stop and remove containers

# View logs
npm run podman:logs       # Follow logs from all services

# Clean everything (including data)
npm run podman:clean      # Remove containers, volumes, and networks

# Database operations
npm run podman:db:migrate # Run Prisma migrations
npm run podman:db:studio  # Open Prisma Studio
npm run podman:db:reset   # Reset database
```

## Services Included

### 🐘 PostgreSQL Database
- **Port:** 5432
- **Database:** wallpaper_db
- **Username:** postgres
- **Password:** password
- **Data persistence:** Yes (via Podman volume)

### 🔴 Redis Cache
- **Port:** 6379
- **Data persistence:** Yes (via Podman volume)
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

## Podman vs Docker Commands

| Docker Command | Podman Equivalent |
|---------------|------------------|
| `docker-compose up` | `podman-compose up` |
| `docker-compose down` | `podman-compose down` |
| `docker-compose logs -f` | `podman-compose logs -f` |
| `docker-compose exec app sh` | `podman-compose exec app sh` |

## Troubleshooting

### 1. Podman Compose Not Found
If you get "podman-compose: command not found":

```bash
# Check installation
C:\Users\lybach1134\AppData\Roaming\Python\Python314\Scripts\podman-compose.exe --version

# Or add to PATH (run once)
setx PATH "%PATH%;C:\Users\lybach1134\AppData\Roaming\Python\Python314\Scripts"
```

### 2. Permission Issues on Windows
```bash
# Enable user namespaces
podman system migrate

# Or run as root if needed (not recommended)
podman-compose --root run ...
```

### 3. Port Already in Use
If you get port conflicts, change the ports in `docker-compose.yml`:

```yaml
ports:
  - "3001:3000"  # Use 3001 instead of 3000
```

### 4. Database Connection Issues
1. Make sure PostgreSQL container is healthy:
   ```bash
   podman-compose ps
   ```

2. Check PostgreSQL logs:
   ```bash
   podman-compose logs postgres
   ```

3. Reset database:
   ```bash
   npm run podman:db:reset
   ```

### 5. Migration Issues
If migrations fail:

1. Access the app container:
   ```bash
   podman-compose exec app sh
   ```

2. Run migrations manually:
   ```bash
   npx prisma migrate dev
   ```

3. Exit container:
   ```bash
   exit
   ```

### 6. Pod System Issues
```bash
# Reset podman system
podman system reset --force

# Restart podman service
podman machine restart
```

## Advanced Podman Usage

### Working with Pods
```bash
# Create a pod for better organization
podman pod create --name wallpaper-app -p 3000:3000 -p 5432:5432 -p 6379:6379 -p 5555:5555

# Run containers in pod
podman run --pod wallpaper-app -d --name postgres postgres:16-alpine
```

### Rootless vs Rootful
```bash
# Check current mode
podman info

# Run rootful (if needed)
podman-compose --root run ...
```

## Development Workflow

1. **Make code changes** → Auto hot reload
2. **Database schema changes** → Run `npm run podman:db:migrate`
3. **View data** → Open http://localhost:5555 (Prisma Studio)
4. **View logs** → Run `npm run podman:logs`
5. **Stop everything** → Run `npm run podman:down`

## Production Deployment to Vercel

For production deployment to Vercel, the process is the same:

1. **Configure environment variables in Vercel:**
   - `DATABASE_URL` (from Vercel Prisma Postgres)
   - `PRISMA_DATABASE_URL` (from Vercel Prisma Postgres)
   - `VITE_GOOGLE_CLIENT_ID`
   - `VITE_GOOGLE_CLIENT_SECRET`

2. **Deploy to Vercel:**
   ```bash
   npm run deploy
   ```

## Architecture with Podman

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

## Benefits of Using Podman

- 🔒 **Rootless by default** - More secure
- 🏗️ **Docker-compatible** - Same commands and workflows
- 🐛 **Better daemon** - No single point of failure
- 🌍 **Better Windows support** - Native WSL2 integration
- 📦 **Pods concept** - Better container organization

## Support

If you encounter issues:

1. Check Podman is running: `podman info`
2. Verify podman-compose: `C:\Users\lybach1134\AppData\Roaming\Python\Python314\Scripts\podman-compose.exe --version`
3. Run `npm run podman:logs` to see error messages
4. Try `npm run podman:clean` then `npm run podman:dev`
5. Check Windows permissions and user namespaces

## Next Steps

After setup is working:
1. Run `npm run podman:dev` to start development
2. Visit http://localhost:3000 to see your app
3. Visit http://localhost:5555 to manage database
4. Start coding! 🚀