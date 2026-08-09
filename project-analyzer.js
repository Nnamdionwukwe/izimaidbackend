// project-analyzer.js
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import readline from "readline";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

class ProjectAnalyzer {
  constructor(projectPath = process.cwd()) {
    this.projectPath = projectPath;
    this.projectInfo = {
      name: path.basename(projectPath),
      path: projectPath,
      packageJson: null,
      dependencies: {},
      devDependencies: {},
      scripts: {},
      structure: {},
      environment: {},
      database: null,
      apiEndpoints: [],
      middleware: [],
      models: [],
      routes: [],
      configFiles: [],
      gitInfo: null,
      hasTypeModule: false,
    };
  }

  async analyze() {
    console.log(
      `${colors.bright}${colors.cyan}📊 Analyzing Project: ${this.projectInfo.name}${colors.reset}\n`,
    );

    try {
      await this.getPackageInfo();
      await this.analyzeStructure();
      await this.detectDatabase();
      await this.analyzeAPIFiles();
      await this.analyzeConfigFiles();
      await this.getGitInfo();
      await this.detectEnvironmentVariables();
      await this.analyzeEntryPoint();

      this.displayFullReport();
      this.generateMigrationPlan();
    } catch (error) {
      console.error(
        `${colors.red}Error analyzing project:${colors.reset}`,
        error.message,
      );
    }
  }

  async getPackageInfo() {
    const packagePath = path.join(this.projectPath, "package.json");
    if (fs.existsSync(packagePath)) {
      const content = fs.readFileSync(packagePath, "utf8");
      this.projectInfo.packageJson = JSON.parse(content);
      this.projectInfo.dependencies =
        this.projectInfo.packageJson.dependencies || {};
      this.projectInfo.devDependencies =
        this.projectInfo.packageJson.devDependencies || {};
      this.projectInfo.scripts = this.projectInfo.packageJson.scripts || {};
      this.projectInfo.hasTypeModule =
        this.projectInfo.packageJson.type === "module";

      console.log(`${colors.green}✓ Package.json loaded${colors.reset}`);
      console.log(`  Framework: ${this.detectFramework()}`);
      console.log(
        `  Module System: ${this.projectInfo.hasTypeModule ? "ES Module" : "CommonJS"}`,
      );
      console.log(
        `  Dependencies: ${Object.keys(this.projectInfo.dependencies).length}`,
      );
      console.log(
        `  Dev Dependencies: ${Object.keys(this.projectInfo.devDependencies).length}\n`,
      );
    } else {
      console.log(`${colors.yellow}⚠ No package.json found${colors.reset}`);
    }
  }

  detectFramework() {
    const deps = this.projectInfo.dependencies;
    if (deps.express) return "Express.js";
    if (deps.koa) return "Koa.js";
    if (deps.fastify) return "Fastify";
    if (deps["@nestjs/core"]) return "NestJS";
    if (deps["@hapi/hapi"]) return "Hapi.js";
    if (deps.adonis) return "AdonisJS";
    if (deps["@adonisjs/core"]) return "AdonisJS";
    return "Unknown Framework";
  }

  async analyzeStructure() {
    console.log(
      `${colors.cyan}📁 Analyzing Directory Structure...${colors.reset}`,
    );

    const ignore = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "coverage",
      ".vercel",
    ];
    const structure = this.getDirectoryStructure(this.projectPath, ignore);
    this.projectInfo.structure = structure;

    // Analyze specific directories
    const dirs = [
      "src",
      "api",
      "routes",
      "controllers",
      "models",
      "middleware",
      "services",
      "utils",
      "config",
      "lib",
    ];

    dirs.forEach((dir) => {
      const dirPath = path.join(this.projectPath, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath);
        console.log(`  📂 ${dir}/ (${files.length} items)`);
        if (files.length > 0 && files.length <= 10) {
          files.forEach((file) => {
            const fullPath = path.join(dirPath, file);
            const isDir = fs.statSync(fullPath).isDirectory();
            console.log(`    ${isDir ? "📁" : "📄"} ${file}`);
          });
        } else if (files.length > 10) {
          files.slice(0, 5).forEach((file) => console.log(`    📄 ${file}`));
          console.log(`    ... and ${files.length - 5} more items`);
        }
      }
    });
    console.log();
  }

  getDirectoryStructure(dir, ignore = [], prefix = "") {
    const items = fs.readdirSync(dir);
    const structure = {};

    items.forEach((item) => {
      if (ignore.includes(item)) return;

      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        structure[item] = this.getDirectoryStructure(
          fullPath,
          ignore,
          `${prefix}${item}/`,
        );
      } else {
        if (!structure.files) structure.files = [];
        structure.files.push(item);

        // Detect important file types
        const ext = path.extname(item);
        if ([".js", ".ts", ".json", ".env", ".yml", ".yaml"].includes(ext)) {
          if (!structure.configFiles) structure.configFiles = [];
          structure.configFiles.push(item);
        }
      }
    });

    return structure;
  }

  async detectDatabase() {
    console.log(`${colors.cyan}🗄️ Detecting Database...${colors.reset}`);

    const deps = this.projectInfo.dependencies || {};
    const dbKeywords = {
      mongoose: "MongoDB",
      mongodb: "MongoDB (Native)",
      pg: "PostgreSQL",
      sequelize: "Sequelize (Multiple DB)",
      typeorm: "TypeORM (Multiple DB)",
      mysql2: "MySQL",
      mysql: "MySQL",
      sqlite3: "SQLite",
      redis: "Redis",
      "@prisma/client": "Prisma (Multiple DB)",
      "drizzle-orm": "Drizzle (Multiple DB)",
    };

    let detected = false;
    for (const [dep, db] of Object.entries(dbKeywords)) {
      if (deps[dep]) {
        this.projectInfo.database = db;
        console.log(
          `  ${colors.green}✓ Database detected: ${db}${colors.reset}`,
        );
        console.log(`  Driver: ${dep}`);
        detected = true;
        break;
      }
    }

    if (!detected) {
      // Check for config files
      const dbConfigFiles = [
        "database.js",
        "database.json",
        "db.js",
        "sequelize.js",
        "prisma/schema.prisma",
        "drizzle.config.ts",
      ];
      const found = dbConfigFiles.find((file) =>
        fs.existsSync(path.join(this.projectPath, file)),
      );
      if (found) {
        console.log(
          `  ${colors.yellow}⚠ Possible database config found: ${found}${colors.reset}`,
        );
      } else {
        console.log(`  ${colors.yellow}⚠ No database detected${colors.reset}`);
      }
    }
    console.log();
  }

  async analyzeAPIFiles() {
    console.log(`${colors.cyan}🌐 Analyzing API Routes...${colors.reset}`);

    const apiPaths = [
      "src/routes",
      "src/api",
      "routes",
      "api",
      "src/controllers",
      "controllers",
      "src/handlers",
    ];
    let totalRoutes = 0;
    let routeFiles = [];

    apiPaths.forEach((apiPath) => {
      const fullPath = path.join(this.projectPath, apiPath);
      if (fs.existsSync(fullPath)) {
        const files = this.findFiles(fullPath, [".js", ".ts"]);
        if (files.length > 0) {
          console.log(`  📍 ${apiPath}:`);
          files.slice(0, 10).forEach((file) => {
            const relative = path.relative(this.projectPath, file);
            console.log(`    📄 ${relative}`);
            routeFiles.push(relative);
            totalRoutes++;
          });
          if (files.length > 10) {
            console.log(`    ... and ${files.length - 10} more files`);
          }
        }
      }
    });

    // Also check for routes defined in app.js or server.js
    const mainFiles = ["app.js", "server.js", "index.js", "main.js"];
    mainFiles.forEach((file) => {
      const fullPath = path.join(this.projectPath, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (
          content.includes("app.use") ||
          content.includes("app.get") ||
          content.includes("app.post") ||
          content.includes("router.") ||
          content.includes("express.Router")
        ) {
          console.log(`  📄 ${file} (contains route definitions)`);
          routeFiles.push(file);
        }
      }
    });

    if (totalRoutes === 0 && routeFiles.length === 0) {
      console.log(`  ${colors.yellow}⚠ No API routes found${colors.reset}`);
    } else {
      console.log(
        `  ${colors.green}✓ Found ${routeFiles.length} potential route files${colors.reset}`,
      );
    }
    console.log();
  }

  findFiles(dir, extensions) {
    const files = [];
    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);

    items.forEach((item) => {
      const fullPath = path.join(dir, item);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        files.push(...this.findFiles(fullPath, extensions));
      } else if (extensions.some((ext) => item.endsWith(ext))) {
        files.push(fullPath);
      }
    });

    return files;
  }

  async analyzeConfigFiles() {
    console.log(
      `${colors.cyan}⚙️ Analyzing Configuration Files...${colors.reset}`,
    );

    const configPatterns = [
      ".env",
      ".env.example",
      ".env.local",
      ".env.production",
      "config.js",
      "config.json",
      "config.yml",
      "config.yaml",
      "database.yml",
      "database.json",
      "docker-compose.yml",
      "Dockerfile",
      "nginx.conf",
      "pm2.json",
      "ecosystem.config.js",
      "ecosystem.config.cjs",
      ".gitignore",
      "vercel.json",
      "jest.config.js",
      "vitest.config.js",
    ];

    const found = [];
    configPatterns.forEach((pattern) => {
      const fullPath = path.join(this.projectPath, pattern);
      if (fs.existsSync(fullPath)) {
        found.push(pattern);
        console.log(`  📄 ${pattern}`);
      }
    });

    if (found.length === 0) {
      console.log(
        `  ${colors.yellow}⚠ No configuration files found${colors.reset}`,
      );
    }
    console.log();
  }

  async getGitInfo() {
    try {
      const gitRemote = execSync("git remote get-url origin", {
        cwd: this.projectPath,
        stdio: ["pipe", "pipe", "ignore"],
      })
        .toString()
        .trim();

      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.projectPath,
        stdio: ["pipe", "pipe", "ignore"],
      })
        .toString()
        .trim();

      this.projectInfo.gitInfo = { remote: gitRemote, branch };

      console.log(`${colors.cyan}🔗 Git Repository:${colors.reset}`);
      console.log(`  Remote: ${gitRemote}`);
      console.log(`  Branch: ${branch}`);
      console.log();
    } catch (error) {
      console.log(`${colors.yellow}⚠ No git repository found${colors.reset}`);
      console.log();
    }
  }

  async detectEnvironmentVariables() {
    console.log(`${colors.cyan}🔐 Environment Variables...${colors.reset}`);

    const envFiles = [".env", ".env.example", ".env.local", ".env.production"];
    const variables = new Set();

    envFiles.forEach((filename) => {
      const fullPath = path.join(this.projectPath, filename);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split("\n");
        lines.forEach((line) => {
          // Skip comments and empty lines
          if (line.startsWith("#") || line.trim() === "") return;
          const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
          if (match) {
            variables.add(match[1]);
          }
        });
      }
    });

    if (variables.size > 0) {
      console.log(
        `  ${colors.green}Found ${variables.size} environment variables:${colors.reset}`,
      );
      Array.from(variables)
        .slice(0, 10)
        .forEach((v) => console.log(`    ${v}`));
      if (variables.size > 10) {
        console.log(`    ... and ${variables.size - 10} more`);
      }
    } else {
      console.log(
        `  ${colors.yellow}⚠ No environment variables detected${colors.reset}`,
      );
    }
    console.log();
  }

  async analyzeEntryPoint() {
    console.log(`${colors.cyan}🚀 Entry Point Analysis...${colors.reset}`);

    const possibleEntries = [
      "server.js",
      "app.js",
      "index.js",
      "main.js",
      "src/index.js",
      "src/server.js",
    ];
    let found = false;

    for (const entry of possibleEntries) {
      const fullPath = path.join(this.projectPath, entry);
      if (fs.existsSync(fullPath)) {
        console.log(
          `  ${colors.green}✓ Entry point found: ${entry}${colors.reset}`,
        );
        found = true;
        break;
      }
    }

    if (!found && this.projectInfo.packageJson) {
      console.log(`  ${colors.yellow}⚠ No entry point found${colors.reset}`);
      console.log(
        `  Main script in package.json: ${this.projectInfo.packageJson.main || "Not specified"}`,
      );
    }
    console.log();
  }

  displayFullReport() {
    console.log(
      `${colors.bright}${colors.magenta}═══════════════════════════════════════════${colors.reset}`,
    );
    console.log(
      `${colors.bright}${colors.magenta}  📋 COMPLETE PROJECT ANALYSIS REPORT${colors.reset}`,
    );
    console.log(
      `${colors.bright}${colors.magenta}═══════════════════════════════════════════${colors.reset}\n`,
    );

    console.log(`${colors.bright}📦 Package Information${colors.reset}`);
    console.log(`  Name: ${this.projectInfo.packageJson?.name || "N/A"}`);
    console.log(`  Version: ${this.projectInfo.packageJson?.version || "N/A"}`);
    console.log(`  Framework: ${this.detectFramework()}`);
    console.log(
      `  Module System: ${this.projectInfo.hasTypeModule ? "ES Module (type: module)" : "CommonJS"}`,
    );
    console.log(
      `  Node Version: ${this.projectInfo.packageJson?.engines?.node || "Not specified"}`,
    );
    console.log();

    console.log(`${colors.bright}📂 Directory Structure${colors.reset}`);
    this.printDirectoryStructure(this.projectInfo.structure, "", 0);
    console.log();

    console.log(`${colors.bright}🔧 Scripts Available${colors.reset}`);
    if (this.projectInfo.scripts) {
      Object.entries(this.projectInfo.scripts).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }
    console.log();

    console.log(
      `${colors.bright}📦 Dependencies (${Object.keys(this.projectInfo.dependencies).length})${colors.reset}`,
    );
    const deps = Object.entries(this.projectInfo.dependencies || {});
    deps.slice(0, 10).forEach(([name, version]) => {
      console.log(`  ${name}: ${version}`);
    });
    if (deps.length > 10) console.log(`  ... and ${deps.length - 10} more`);

    console.log(
      `${colors.bright}📦 Dev Dependencies (${Object.keys(this.projectInfo.devDependencies || {}).length})${colors.reset}`,
    );
    const devDeps = Object.entries(this.projectInfo.devDependencies || {});
    devDeps.slice(0, 10).forEach(([name, version]) => {
      console.log(`  ${name}: ${version}`);
    });
    if (devDeps.length > 10)
      console.log(`  ... and ${devDeps.length - 10} more`);
    console.log();

    console.log(`${colors.bright}🗄️ Database${colors.reset}`);
    console.log(`  Type: ${this.projectInfo.database || "Not detected"}`);
    console.log();

    console.log(`${colors.bright}🚀 Deployment Configuration${colors.reset}`);
    console.log(
      `  Main entry: ${this.projectInfo.packageJson?.main || "Not specified"}`,
    );
    console.log(
      `  Start script: ${this.projectInfo.scripts?.start || "Not defined"}`,
    );
    console.log();

    console.log(`${colors.bright}🌐 External Services${colors.reset}`);
    console.log(
      `  Git Repository: ${this.projectInfo.gitInfo?.remote || "Not found"}`,
    );
    console.log(`  Branch: ${this.projectInfo.gitInfo?.branch || "Not found"}`);
    console.log();

    console.log(
      `${colors.bright}${colors.green}✅ Analysis Complete!${colors.reset}`,
    );
    console.log(
      `${colors.bright}${colors.magenta}═══════════════════════════════════════════${colors.reset}\n`,
    );
  }

  printDirectoryStructure(structure, prefix = "", depth = 0) {
    if (!structure || typeof structure !== "object") return;

    const items = Object.keys(structure);
    items.forEach((key, index) => {
      const isLast = index === items.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const indent = depth > 0 ? "    " : "";

      if (
        structure[key] &&
        typeof structure[key] === "object" &&
        !Array.isArray(structure[key])
      ) {
        console.log(`${indent}${connector}${key}/`);
        this.printDirectoryStructure(structure[key], "", depth + 1);
      } else if (key === "files" && Array.isArray(structure.files)) {
        structure.files.slice(0, 5).forEach((file, i) => {
          const isLastFile = i === Math.min(4, structure.files.length - 1);
          const fileConnector = isLastFile ? "└── " : "├── ";
          console.log(`${indent}    ${fileConnector}${file}`);
        });
        if (structure.files.length > 5) {
          console.log(
            `${indent}    └── ... and ${structure.files.length - 5} more files`,
          );
        }
      }
    });
  }

  generateMigrationPlan() {
    console.log(
      `${colors.bright}${colors.blue}📋 Migration Plan Generated${colors.reset}`,
    );
    console.log(
      `${colors.bright}${colors.blue}═══════════════════════════════════════════${colors.reset}\n`,
    );

    console.log(
      `${colors.bright}To migrate to Digital Ocean, we need to:${colors.reset}\n`,
    );

    // 1. Infrastructure Setup
    console.log(`${colors.cyan}1. Infrastructure Setup:${colors.reset}`);
    console.log(`   □ Create Digital Ocean Droplet (Ubuntu 22.04)`);
    console.log(
      `   □ Set up Node.js ${this.projectInfo.packageJson?.engines?.node || "18.x"} environment`,
    );
    console.log(`   □ Install PM2 for process management`);
    console.log(`   □ Configure firewall (UFW)`);
    console.log(`   □ Set up SSH keys and security`);
    console.log(`   □ Configure Nginx as reverse proxy`);

    // 2. Database
    if (this.projectInfo.database) {
      console.log(`\n${colors.cyan}2. Database Setup:${colors.reset}`);
      console.log(`   □ Set up ${this.projectInfo.database}`);
      console.log(`   □ Configure backups`);
      console.log(`   □ Set up connection strings in .env`);
      console.log(`   □ Consider using Digital Ocean Managed Database`);
    }

    // 3. Environment Configuration
    console.log(`\n${colors.cyan}3. Environment Configuration:${colors.reset}`);
    console.log(`   □ Create .env file with all required variables`);
    console.log(`   □ Configure CORS for Vercel frontend domain`);
    console.log(`   □ Set up SSL/HTTPS with Let's Encrypt`);
    console.log(`   □ Configure Nginx reverse proxy with SSL`);

    // 4. Application Deployment
    console.log(`\n${colors.cyan}4. Application Deployment:${colors.reset}`);
    console.log(`   □ Clone GitHub repository`);
    console.log(`   □ Install dependencies (npm ci)`);
    if (this.projectInfo.hasTypeModule) {
      console.log(`   □ Note: Project uses ES Modules (type: module)`);
    }
    console.log(`   □ Build the application (npm run build if available)`);
    console.log(`   □ Set up PM2 with ecosystem.config.js`);
    console.log(`   □ Configure auto-restart and logging`);

    // 5. CI/CD
    console.log(`\n${colors.cyan}5. CI/CD Setup:${colors.reset}`);
    console.log(`   □ Set up GitHub Actions for automatic deployment`);
    console.log(`   □ Or configure webhook for deploy on push`);

    // 6. Monitoring
    console.log(`\n${colors.cyan}6. Monitoring & Logging:${colors.reset}`);
    console.log(`   □ Set up PM2 monitoring (pm2 monit)`);
    console.log(`   □ Configure error logging with Winston or Pino`);
    console.log(`   □ Set up health check endpoint`);
    console.log(`   □ Consider Digital Ocean Monitoring`);

    // 7. Performance
    console.log(`\n${colors.cyan}7. Performance Optimization:${colors.reset}`);
    console.log(`   □ Enable compression (express compression)`);
    console.log(`   □ Configure caching (Redis if needed)`);
    console.log(`   □ Set up rate limiting`);
    console.log(`   □ Consider using Digital Ocean Load Balancer`);

    // 8. Final Steps
    console.log(`\n${colors.cyan}8. Final Steps:${colors.reset}`);
    console.log(`   □ Update Vercel frontend API URL to Digital Ocean IP`);
    console.log(`   □ Test all endpoints`);
    console.log(`   □ Update DNS if needed`);
    console.log(`   □ Set up SSL certificates`);
    console.log(`   □ Configure automatic backups`);

    console.log(
      `\n${colors.bright}${colors.green}✅ Migration Checklist Generated!${colors.reset}`,
    );
    console.log(
      `${colors.bright}${colors.blue}═══════════════════════════════════════════${colors.reset}\n`,
    );
  }
}

// Main execution
async function main() {
  console.log(
    `${colors.bright}${colors.cyan}🚀 Railway → Digital Ocean Migration Assistant${colors.reset}\n`,
  );

  const projectPath = process.argv[2] || process.cwd();
  console.log(`📂 Analyzing project at: ${projectPath}\n`);

  const analyzer = new ProjectAnalyzer(projectPath);

  await analyzer.analyze();

  rl.question("\nPress Enter to exit...", () => {
    rl.close();
  });
}

// Run the analyzer
main().catch(console.error);
