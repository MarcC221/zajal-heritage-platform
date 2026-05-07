# Zajal Heritage Platform

A platform for exploring and interacting with Zajal Arabic poetry heritage, powered by local AI.

---

## Before You Start — Install These First

You need two free programs installed before anything else.

### 1. Python 3.9 or newer
Download from: https://www.python.org/downloads/

> **Windows users:** During installation, make sure to check **"Add Python to PATH"** before clicking Install. If you miss this, Python won't work from the terminal.

### 2. Ollama (runs the AI model on your computer)
Download from: https://ollama.ai/

After installing, **open Ollama** and leave it running in the background. You should see its icon in your taskbar (Windows) or menu bar (Mac).

---

## Setup — Do This Once

### Step 1 — Extract the ZIP file

Unzip the file you received. You should end up with a folder called `zajal-heritage-platform-main`. Put it somewhere easy to find, like your Desktop.

---

### Step 2 — Open Command Prompt and navigate to the project folder

Press `Windows + R`, type `cmd`, and press Enter. Then navigate to the project folder by typing:

```bash
cd C:\Users\YourName\Desktop\zajal-heritage-platform-main
```

Replace `YourName` with your actual Windows username and adjust the path if you extracted the folder somewhere other than the Desktop.

---

### Step 3 — Create a virtual environment

```bash
python -m venv venv
```

This creates an isolated space for the project's packages. You only need to do this once.

---

### Step 4 — Activate the virtual environment

```bash
venv\Scripts\activate.bat
```

---

### Step 5 — Install all dependencies

```bash
pip install -r requirements.txt
```

> This downloads all required packages including the AI embedding model. It may take **3–10 minutes** depending on your internet speed. Just wait for it to finish.

---

### Step 6 — Download the AI model

```bash
ollama pull qwen2.5:7b-instruct-q4_K_M
```

> This downloads the AI model (~4 GB). It only needs to be done **once**. Make sure Ollama is open and running before doing this.

---

## Running the Project — Do This Every Time

**1. Make sure Ollama is running**
Check that the Ollama icon is in your taskbar. If not, open it again.

**2. Open Command Prompt and navigate to the project folder**

```bash
cd C:\Users\YourName\Desktop\zajal-heritage-platform-main
```

Then activate the virtual environment:

```bash
venv\Scripts\activate.bat
```

**3. Start the server**

```bash
python main.py
```

> The **first time** you start the server, it may take 2–3 minutes to load the data. Wait until you see a message saying the server is ready.

**4. Open the app in your browser**

```
http://localhost:8000
```

The platform is now running and ready to use.

---

*Marc Chehwan · USEK · Spring 2026*