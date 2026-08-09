# 🖥️ Sam Cloud IDE

A powerful **browser-based development environment** built to bring a real IDE experience directly into your browser.

**Sam Cloud IDE** is designed like a lightweight, browser-native alternative to traditional desktop development environments such as VS Code. It combines a professional code editor, file explorer, terminal, live preview, multiple programming languages, package management, webcam support, and an AI coding assistant into one unified workspace.

> 🚀 **Write code. Install packages. Run projects. Preview applications. Get AI assistance — all from one browser-based IDE.**

---

# ✨ Features

## ⚡ Real IDE-Style Code Editor

Sam Cloud IDE is designed to provide a development experience similar to a modern desktop IDE.

### Features include:

* 📝 Monaco-based code editor
* 📑 Multiple file tabs
* 📂 Project file explorer
* 🔍 Code navigation
* 🎨 Syntax highlighting
* 🧩 Multi-language support
* ⚙️ Editor settings
* 💾 Save / Save All
* ▶️ Run
* ⏹️ Stop
* 📥 Download
* 📤 Upload
* 🖥️ Multi-panel development workspace

The goal is to make the browser feel like a **real development workstation** rather than a simple online code editor.

---

# 🌍 Multi-Language Development

Sam Cloud IDE is designed to work with multiple programming languages and development technologies.

Supported development environments include:

* 🐍 Python
* 🌐 HTML
* 🎨 CSS
* ⚡ JavaScript
* 🟦 TypeScript
* 🟢 Node.js
* 📦 npm-based projects
* 📦 Package-based JavaScript projects

The architecture is designed to allow additional languages and runtimes to be added in the future.

---

# 🐍 Python Development

Python execution is supported directly inside the browser using **Pyodide and WebAssembly**.

Example:

```python
name = "Sam"

print(f"Hello from Sam Cloud IDE!")
```

The browser-based Python runtime allows Python code to be executed without requiring a traditional local Python installation for supported browser execution.

---

# 🟢 Node.js Development

Sam Cloud IDE is designed to support Node.js-based development workflows.

Developers can work with:

```text
Node.js
npm
JavaScript
TypeScript
package.json
```

This makes the IDE suitable for building and experimenting with modern JavaScript and TypeScript applications.

---

# 📦 Package Installation

One of the major goals of Sam Cloud IDE is to provide a development environment where users can **manage project dependencies directly from the IDE**.

Package-based workflows can include:

```text
npm install
npm run
package.json
package-lock.json
```

This allows projects to work with external libraries and dependencies instead of being restricted to completely standalone browser code.

### Example

```bash
npm install express
```

or:

```bash
npm install react
```

The package management architecture provides a foundation for a more complete browser-based development workflow.

---

# 🤖 AI Coding Assistant

Sam Cloud IDE includes an integrated **AI development assistant powered by the Groq API**.

The AI assistant is designed to work alongside the developer while coding.

Instead of switching between:

```text
IDE
   ↓
Browser
   ↓
AI Chat
   ↓
Copy Code
   ↓
Back to IDE
```

Sam Cloud IDE aims to provide:

```text
        ┌─────────────────────────┐
        │     SAM CLOUD IDE       │
        ├─────────────────────────┤
        │                         │
        │       CODE EDITOR       │
        │                         │
        │      Your code...       │
        │                         │
        ├─────────────────────────┤
        │      🤖 AI ASSISTANT    │
        │                         │
        │  Analyze current code   │
        │  Explain                │
        │  Fix                    │
        │  Improve                │
        │  Generate               │
        └─────────────────────────┘
```

### AI capabilities

The AI assistant can help with:

* 🤖 Code explanation
* 🐛 Bug analysis
* 🔧 Code fixing
* ✨ Code improvement
* 📝 Code generation
* 🔍 Code analysis
* 💡 Development suggestions
* 📚 Learning and explanations
* 🧠 Understanding the code currently being worked on

---

# 🔑 Groq API Configuration

The AI assistant uses the **Groq API**.

Users can configure their API key through the IDE's **Settings** menu.

### Setup

1. Open Sam Cloud IDE.
2. Open **Settings**.
3. Find the AI / Groq configuration.
4. Paste your Groq API key.
5. Save the configuration.
6. Open the AI assistant.
7. Start working with your code.

This allows users to provide their own Groq API credentials instead of requiring a shared API key.

> 🔐 **Security note:** Never publish your Groq API key in source code or commit it to GitHub.

---

# 🧠 AI + Real-Time Coding Workflow

The AI assistant is designed around the code you are actively working on.

Instead of manually copying large sections of code into an external AI service, the IDE can provide the assistant with relevant editor/workspace context.

This enables workflows such as:

```text
Write Code
    ↓
AI Sees Relevant Code
    ↓
Ask Question
    ↓
AI Analyzes Context
    ↓
Get Explanation / Fix / Suggestion
    ↓
Continue Coding
```

This creates a more integrated **AI-powered development experience**.

---

# 📷 Camera / Webcam Integration

Sam Cloud IDE includes **camera/webcam support**.

The browser can request access to the user's webcam through browser permissions.

Possible applications include:

* 📷 Webcam preview
* 👁️ Computer vision experiments
* 🤖 AI/ML projects
* 🧪 Vision-based experiments
* 🎥 Browser-based development tools
* 🔬 Future computer vision integrations

The camera functionality provides a foundation for bringing hardware and vision-based experiments into the development environment.

---

# 📁 File Explorer

Sam Cloud IDE includes an interactive project file explorer.

Developers can work with:

* 📄 Files
* 📁 Folders
* 📂 Project directories
* 📝 Multiple files
* 📑 File tabs
* 📥 Uploaded files
* 📤 Downloaded projects

Typical project structure:

```text
project/
│
├── index.html
├── style.css
├── script.js
├── package.json
└── src/
```

---

# 💻 Integrated Terminal

Sam Cloud IDE includes a built-in terminal designed to provide a familiar development workflow.

Available workspace commands include:

```text
help
clear
ls
cat
run
echo
```

The terminal is designed to evolve toward a more complete development shell.

---

# 🌐 Live Preview

Web projects can be previewed directly inside the IDE.

Supported technologies include:

* HTML
* CSS
* JavaScript
* TypeScript
* Browser-based applications

Example:

```text
index.html
style.css
script.js
```

The workflow becomes:

```text
Edit
 ↓
Save
 ↓
Run
 ↓
Preview
 ↓
Debug
 ↓
Repeat
```

---

# 📊 Output & Problems

Sam Cloud IDE includes dedicated development feedback panels.

### Output

View:

* Program output
* Runtime messages
* Development logs
* Command results

### Problems

View:

* Errors
* Warnings
* Diagnostics
* Development problems

This provides a workflow closer to a traditional desktop IDE.

---

# 🛠️ Quick Actions

The IDE provides quick actions for common development tasks.

| Action      | Purpose                   |
| ----------- | ------------------------- |
| 🆕 New      | Create a new file/project |
| 💾 Save     | Save the current file     |
| 💾 Save All | Save workspace changes    |
| ▶️ Run      | Execute supported code    |
| ⏹️ Stop     | Stop execution            |
| 📥 Download | Download project/files    |
| 📤 Upload   | Upload files/projects     |

---

# ⚙️ Settings

Sam Cloud IDE includes a configurable settings area.

Settings can be used for development environment preferences and AI configuration.

The Settings system provides a foundation for future features such as:

* 🎨 Editor preferences
* 🖥️ Layout settings
* 🤖 AI configuration
* 🔑 API configuration
* ⚙️ Runtime settings
* 🌐 Preview configuration

---

# 🎨 Modern IDE Interface

Sam Cloud IDE is designed with a modern dark developer interface inspired by professional development environments.

The workspace can include:

```text
┌───────────────────────────────────────────────────────────┐
│ SAM CLOUD IDE                         ⚙ Settings   🤖 AI │
├──────────────┬───────────────────────────────┬────────────┤
│              │                               │            │
│ FILE         │          EDITOR               │ AI         │
│ EXPLORER     │                               │ ASSISTANT  │
│              │       Monaco Editor            │            │
│ 📁 src       │       code...                 │ Explain    │
│ 📄 index     │                               │ Fix        │
│ 📄 main      │                               │ Improve    │
│              │                               │            │
├──────────────┴───────────────────────────────┴────────────┤
│ TERMINAL │ OUTPUT │ PROBLEMS │ PREVIEW │ CAMERA           │
└───────────────────────────────────────────────────────────┘
```

---

# 🎯 Vision

Sam Cloud IDE is built around one simple idea:

> **What if VS Code-like development could happen directly inside a browser?**

Traditional development environments require developers to install and configure:

```text
Code Editor
+
Runtime
+
Terminal
+
Package Manager
+
Browser
+
Extensions
+
AI Tools
+
Project Tools
```

Sam Cloud IDE aims to bring these capabilities together:

```text
                SAM CLOUD IDE
                      │
       ┌──────────────┼──────────────┐
       │              │              │
     Editor         Terminal        AI
       │              │              │
       ├──────────────┼──────────────┤
       │              │              │
   Languages       Packages       Assistant
       │              │              │
       └──────────────┼──────────────┘
                      │
                Live Preview
```

---

# 🚀 Why Sam Cloud IDE?

Instead of constantly switching between different development tools, Sam Cloud IDE aims to provide a unified workspace.

### Traditional workflow

```text
IDE
 ↓
Terminal
 ↓
Browser
 ↓
AI Website
 ↓
Documentation
 ↓
Back to IDE
```

### Sam Cloud IDE workflow

```text
             SAM CLOUD IDE
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
    Editor     Terminal      AI
       │          │          │
       └──────────┼──────────┘
                  ▼
             Live Preview
                  │
                  ▼
              Application
```

---

# 🧩 Core Development Modules

| Module           | Description                            |
| ---------------- | -------------------------------------- |
| 📁 File Explorer | Manage project files and folders       |
| ⚡ Code Editor    | Monaco-based development environment   |
| 💻 Terminal      | Execute development commands           |
| 🐍 Python        | Browser-based Python execution         |
| 🟢 Node.js       | JavaScript/Node development workflows  |
| 🌐 Web           | HTML/CSS/JS development                |
| 📦 Packages      | Dependency installation and management |
| 🌐 Preview       | Live web application preview           |
| 🤖 AI            | Groq-powered coding assistant          |
| 📷 Camera        | Browser webcam integration             |
| 📊 Output        | Runtime and command output             |
| ⚠️ Problems      | Errors and diagnostics                 |
| ⚙️ Settings      | Configure the environment              |

---

# 🌍 Supported Development Stack

Sam Cloud IDE is designed for modern development workflows involving:

```text
Python
HTML
CSS
JavaScript
TypeScript
Node.js
npm
React
Vite
WebAssembly
```

The architecture is designed to allow additional runtimes and technologies to be integrated over time.

---

# 🧭 Development Roadmap

## Stage 0 — Core IDE

* [x] Code editor
* [x] File explorer
* [x] File tabs
* [x] Browser terminal
* [x] Live preview
* [x] Python execution
* [x] Camera support
* [x] Output panel
* [x] Problems panel
* [x] Settings
* [x] Dark UI

---

## Stage 1 — Developer Environment

* [x] Multi-language workflow
* [x] Node.js development support
* [x] Package installation workflow
* [x] Project management
* [x] File upload/download
* [x] IDE-style layout

---

## Stage 2 — AI Development

* [x] Groq API integration
* [x] AI settings
* [x] API key configuration
* [x] AI code assistance
* [x] Code context support

Future:

* [ ] AI code generation
* [ ] AI debugging
* [ ] AI refactoring
* [ ] AI test generation
* [ ] AI documentation
* [ ] AI project analysis
* [ ] AI terminal assistant

---

## Stage 3 — Advanced Developer Tools

* [ ] Git integration
* [ ] GitHub integration
* [ ] Advanced debugging
* [ ] Integrated testing
* [ ] Extension system
* [ ] Advanced package management
* [ ] More programming language runtimes

---

## Stage 4 — Cloud Development

* [ ] User authentication
* [ ] Cloud workspaces
* [ ] Cloud project synchronization
* [ ] Remote execution
* [ ] Remote terminal
* [ ] SSH connectivity
* [ ] Cloud storage

---

## Stage 5 — Collaboration

* [ ] Real-time collaboration
* [ ] Shared projects
* [ ] Live code editing
* [ ] Team workspaces
* [ ] Comments
* [ ] Project permissions
* [ ] Developer presence

---

# 🛠️ Technologies Used

| Technology       | Purpose                      |
| ---------------- | ---------------------------- |
| React            | User interface               |
| TypeScript       | Application development      |
| Vite             | Development/build tooling    |
| Monaco Editor    | Professional code editing    |
| JavaScript       | Browser functionality        |
| HTML5            | Web development              |
| CSS3             | Interface styling            |
| Pyodide          | Python runtime               |
| WebAssembly      | Browser execution            |
| Node.js          | JavaScript runtime workflows |
| npm              | Package management           |
| Groq API         | AI coding assistant          |
| Fetch API        | Network communication        |
| File System APIs | Workspace/file handling      |
| Web APIs         | Browser capabilities         |
| Webcam API       | Camera integration           |

---

# 📂 Project Structure

Current project root:

```text
sam-cloud-ide/
│
├── 📁 node_modules/
├── 📁 src/
│
├── 📄 .git/
├── 📄 .gitignore
├── 📄 .prettierignore
├── 📄 .prettierrc
├── 📄 bun.lock
├── 📄 bunfig.toml
├── 📄 components.json
├── 📄 eslint.config.js
├── 📄 LICENSE
├── 📄 package-info.txt
├── 📄 package-lock.json
├── 📄 package.json
├── 📄 project-structure.txt
├── 📄 README.md
├── 📄 run.bat
├── 📄 tsconfig.json
└── 📄 vite.config.ts
```

### `src/`

Contains the main Sam Cloud IDE application source code.

### `package.json`

Contains project dependencies and npm scripts.

### `vite.config.ts`

Contains Vite configuration.

### `tsconfig.json`

Contains TypeScript configuration.

### `run.bat`

Windows launcher for the development environment.

---

# ⚙️ Requirements

* **Node.js 18+**
* Windows 10 / 11
* npm
* Modern web browser

Node.js:

[Node.js Official Website](https://nodejs.org/?utm_source=chatgpt.com)

Check installation:

```bash
node --version
npm --version
```

---

# 📥 Installation

## Clone the repository

```bash
git clone https://github.com/rsamwilson2323-cloud/Sam-Cloud-IDE.git
```

## Enter the project

```bash
cd Sam-Cloud-IDE
```

## Install dependencies

```bash
npm install
```

---

# ▶️ Run Sam Cloud IDE

Start the development server:

```bash
npm run dev
```

Then open the URL displayed by Vite.

Usually:

```text
http://localhost:5173
```

---

# 🪟 Windows Launcher

Windows users can use:

```text
run.bat
```

Double-click:

```text
run.bat
```

to launch the development environment.

---

# 📦 Package Workflow

Projects can work with package-based JavaScript/Node workflows.

Example:

```bash
npm install express
```

Then:

```bash
npm run dev
```

Package configuration is stored through project files such as:

```text
package.json
package-lock.json
```

---

# 🤖 AI Setup

To use the AI assistant:

### 1. Obtain a Groq API key

Create/configure your Groq API access.

### 2. Open Sam Cloud IDE

Start the project:

```bash
npm run dev
```

### 3. Open Settings

Navigate to:

```text
Settings → AI / Groq
```

### 4. Paste your API key

Enter your Groq API key into the provided configuration field.

### 5. Save

Save the configuration and open the AI assistant.

### 6. Start coding

Ask the AI to:

```text
Explain this code
Find the bug
Fix this function
Improve this component
Generate a solution
Review my code
```

---

# 🔐 API Key Security

Your Groq API key is sensitive.

**Never commit API keys to GitHub.**

Do not place secrets directly into:

```text
README.md
source files
public files
Git commits
GitHub repositories
```

Use appropriate environment/configuration mechanisms where applicable.

---

# 📷 Camera Usage

When a feature requires webcam access, your browser may display a permission request.

Select:

```text
Allow Camera Access
```

The camera functionality can then be used by supported browser features and future computer-vision tools.

---

# 🧪 Development & Testing

Run:

```bash
npm run dev
```

Use the IDE's:

* Console
* Output
* Problems
* Terminal
* Browser developer tools

to identify and debug issues.

---

# 🚀 Production Build

Build the project:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

The exact scripts are defined in `package.json`.

---

# 🏗️ Architecture

```text
                    ┌───────────────────────┐
                    │       BROWSER         │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │    SAM CLOUD IDE      │
                    └───────────┬───────────┘
                                │
        ┌───────────────┬───────┼────────┬───────────────┐
        ▼               ▼       ▼        ▼               ▼
   File Explorer     Editor  Terminal    AI            Camera
        │               │       │        │               │
        └───────────────┴───────┼────────┴───────────────┘
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
          Python              Node.js          Web Stack
         Pyodide                npm          HTML/CSS/JS
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                         Live Preview
```

---

# 💡 Example Workflow

```text
Create Project
      ↓
Create Files
      ↓
Write Code
      ↓
Install Packages
      ↓
Run Project
      ↓
View Output
      ↓
AI Reviews Code
      ↓
Fix / Improve
      ↓
Live Preview
      ↓
Build Application
```

---

# 🔮 Future Vision

Sam Cloud IDE aims to become more than a browser code editor.

The long-term vision is a complete **AI-powered browser-native development environment**.

Potential future:

```text
                     SAM CLOUD IDE
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
      CODE               AI                CLOUD
        │                  │                  │
     Editor            Assistant          Workspace
     Terminal          Debugging          Storage
     Runtime           Generation         Sync
     Packages          Analysis           Deploy
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    COLLABORATION
                           │
                    Developer Teams
```

---

# 🤝 Contributing

Contributions are welcome!

You can contribute through:

* 💻 Code
* 🎨 UI/UX
* 🐛 Bug reports
* 💡 Feature ideas
* 🤖 AI features
* 🧪 Testing
* 📝 Documentation
* ⚡ Performance improvements

### Development

```bash
git clone https://github.com/rsamwilson2323-cloud/Sam-Cloud-IDE.git

cd Sam-Cloud-IDE

npm install

npm run dev
```

Create a branch:

```bash
git checkout -b feature/your-feature
```

Commit changes:

```bash
git add .
git commit -m "Add your feature"
```

Push:

```bash
git push origin feature/your-feature
```

Then open a Pull Request.

---

# 📜 License

This project is licensed under the **MIT License**.

See [`LICENSE`](LICENSE) for details.

---

# 👨‍💻 Author

## Sam Wilson

B.E. Computer Science Engineering student specializing in **Artificial Intelligence & Machine Learning**.

Passionate about:

* 🤖 Artificial Intelligence
* 🧠 Machine Learning
* 💻 Full-Stack Development
* 🛠️ Developer Tools
* 🔐 Cybersecurity
* ⚙️ Automation
* 🚀 Open Source

### 🔗 GitHub

[Sam Wilson on GitHub](https://github.com/rsamwilson2323-cloud?utm_source=chatgpt.com)

### 💼 LinkedIn

[Sam Wilson on LinkedIn](https://www.linkedin.com/in/sam-wilson-14b554385/?utm_source=chatgpt.com)

---

# ⭐ Support the Project

If you like **Sam Cloud IDE**:

⭐ Star the repository

🐛 Report bugs

💡 Suggest features

🤝 Contribute

📢 Share it with other developers

---

# 🚀 Sam Cloud IDE

> **Code. Run. Build. Debug. Ask AI.**

### Your browser. Your IDE. Your AI-powered development workspace.

Built with ❤️ by **Sam Wilson**.
