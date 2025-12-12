# Quick Start Guide - Podman Development

## ✅ Ready to Go!

Your Podman development environment is fully configured and tested.

## 🚀 Start Development

```bash
npm run podman:dev
```

This will:
- ✅ Start PostgreSQL database (port 5432)
- ✅ Start Redis cache (port 6379)
- ✅ Build and start your app (port 3000)
- ✅ Set up Prisma Studio (port 5555)
- ✅ Run database migrations automatically

## 📱 Access Your Services

- **App**: http://localhost:3000
- **Prisma Studio**: http://localhost:5555
- **Database**: localhost:5432 (postgres/password)
- **Redis**: localhost:6379

## 🛠️ Useful Commands

```bash
# Start in background
npm run podman:dev-d

# Stop all services
npm run podman:down

# View logs
npm run podman:logs

# Open database manager
npm run podman:db:studio

# Run migrations
npm run podman:db:migrate

# Clean everything
npm run podman:clean
```

## 🔧 What's Set Up

- ✅ Podman 5.7.0 with WSL2
- ✅ podman-compose 1.5.0
- ✅ PostgreSQL 16 container
- ✅ Redis 7 container
- ✅ Hot reload for code changes
- ✅ Database persistence
- ✅ Health checks for all services

## 📁 Files Created/Updated

- `Dockerfile.dev` - Development container
- `docker-compose.yml` - Service orchestration
- `README-Podman.md` - Detailed documentation
- `package.json` - Podman scripts added
- `.env` - Environment configured
- `.dockerignore` - Docker ignore rules

## 🎯 Next Steps

1. **Run** `npm run podman:dev`
2. **Wait** 2-3 minutes for first build
3. **Visit** http://localhost:3000
4. **Start coding!**

Your app will auto-reload when you make changes.

## 🐛 Troubleshooting

If something goes wrong:

1. **Check logs**: `npm run podman:logs`
2. **Restart clean**: `npm run podman:clean && npm run podman:dev`
3. **Check Podman**: `podman info`

## 🌍 Production Deployment

When you're ready to deploy to Vercel:

```bash
npm run deploy
```

Environment variables will be automatically used from Vercel dashboard.

---

**Happy coding! 🎉**