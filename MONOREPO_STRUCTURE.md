# 🎯 XENO Platform - Monorepo Structure

**Welcome to the XENO Platform monorepo!** This repository contains all core libraries and applications.

---

## 📁 Structure

```
xenostudio/  (ROOT - This is the monorepo)
│
├── libs/                           ← Core Libraries
│   ├── xeno-lib/                   ← Image processing engine (Rust)
│   │   ├── src/
│   │   ├── Cargo.toml
│   │   └── README.md
│   │
│   └── xeno-edit/                  ← Multi-platform bindings
│       ├── server/                 ← REST API (Axum)
│       ├── cli/                    ← Command-line tool
│       ├── python/                 ← Python bindings (PyO3)
│       └── nodejs/                 ← Node.js bindings (NAPI-RS)
│
├── src/                            ← xenostudio Studio Frontend
├── public/                         ← Static assets
├── database/                       ← Database files
├── storage/                        ← File storage
│
├── Cargo.toml                      ← Rust workspace config
├── package.json                    ← Root package.json
└── README.md                       ← Main README
```

---

## 🚀 Quick Start

### **1. Install Dependencies**

```bash
# JavaScript dependencies
npm install

# Rust is already installed (verify with: cargo --version)
```

### **2. Build Libraries**

```bash
# Build all Rust libraries
npm run build:libs

# Or build individually
cd libs/xeno-lib && cargo build --release
cd libs/xeno-edit/server && cargo build --release
```

### **3. Start Development**

```bash
# Start xenostudio studio (frontend)
npm run dev

# Start xeno-edit REST API (in another terminal)
npm run xeno-api
```

---

## 🛠️ Development Workflows

### **Working on xeno-lib (Core Image Processing)**

```bash
cd libs/xeno-lib

# Make changes to Rust code
# Test
cargo test

# Build
cargo build --release

# The REST API and CLI will automatically use the updated library
```

### **Working on REST API**

```bash
cd libs/xeno-edit/server

# Make changes
# Test
cargo run --release

# The API starts on http://localhost:3000
```

### **Working on xenostudio Studio (Frontend)**

```bash
# From root
npm run dev

# Frontend starts on http://localhost:5173
# Calls REST API at http://localhost:3000
```

---

## 📦 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend dev server |
| `npm run build` | Build frontend for production |
| `npm run xeno-api` | Start REST API server |
| `npm run build:libs` | Build all Rust libraries |
| `npm run server` | Start backend server |

---

## 🔗 How Libraries Connect

```
xenostudio Studio (Frontend)
    ↓ HTTP calls
xeno-edit REST API (libs/xeno-edit/server)
    ↓ Uses
xeno-lib (libs/xeno-lib)
    ↓ Processes
Images/Videos
```

---

## 🎯 Monorepo Benefits

✅ **One codebase** - All code in one place
✅ **Atomic changes** - Update library + app in one commit
✅ **Fast iteration** - No version management between repos
✅ **Shared tooling** - One CI/CD, one config
✅ **Easy refactoring** - Changes visible immediately

---

## 📝 Adding New Features

### **To xeno-lib:**

1. Add operation to `libs/xeno-lib/src/`
2. Export in `libs/xeno-lib/src/lib.rs`
3. Add to REST API in `libs/xeno-edit/server/src/processing.rs`
4. Use in frontend via API call

### **To xenostudio Studio:**

1. Make changes in `src/`
2. Call REST API for image processing
3. Test with `npm run dev`

---

## 🧪 Testing

```bash
# Test Rust libraries
cd libs/xeno-lib && cargo test
cd libs/xeno-edit/server && cargo test

# Test frontend
npm test
```

---

## 🚢 Deployment

### **Frontend:**
```bash
npm run build
# Deploy dist/ folder
```

### **REST API:**
```bash
cd libs/xeno-edit/server
cargo build --release
# Deploy target/release/xeno-edit-server
```

---

## 📚 Documentation

- **xeno-lib:** See `libs/xeno-lib/README.md`
- **REST API:** See `libs/xeno-edit/server/README.md`
- **xenostudio Studio:** See main `README.md`

---

## 🎉 You're All Set!

**This is now a unified monorepo containing:**
- ✅ Core image processing library (xeno-lib)
- ✅ REST API server (xeno-edit)
- ✅ xenostudio video studio (frontend)

**Everything works together seamlessly!** 🚀
