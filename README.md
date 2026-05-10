<p align="center">
  <img src="logo.jpeg" width="120" style="border-radius: 60px;">
</p>

# 🛡️ Sentinel: AI-Powered Women's Safety Ecosystem

**Sentinel** is an AI-powered safety application built with **React Native** and **FastAPI**. It features **Sentinel Mode** for autonomous voice threat detection, hardware impact alerts via accelerometers, and intelligent safe-routing via OpenStreetMap. The system includes an **Evidence Vault** to securely store audio logs and transcripts of detected danger for forensic use.

---

## 🚀 Core Features

* **Sentinel Mode (AI Voice Monitor)**: Operates a continuous audio loop to listen for danger keywords like "help" or "police".
* **NLP Threat Analysis**: Audio chunks are processed via a Python backend using Google Speech Recognition to trigger SOS alerts.
* **Hardware Impact Detection**: Uses the device's accelerometer to monitor for sudden drops or forceful impacts, automatically broadcasting alerts if the phone is knocked away.
* **Safe Route Navigation**: Calculates walking paths using OSRM and highlights "Safe Zones" (police, hospitals) via the Overpass API.
* **Evidence Vault**: Automatically preserves audio snippets and written transcripts on the server as proof of incident.
* **Minimalist Aesthetic**: Features a high-end "Blush Pink" dark mode UI designed for clarity and ease of use during high-stress situations.

## 🛠️ Technical Stack

### **Frontend (Mobile App)**
* **Framework**: Expo / React Native.
* **Navigation**: Expo Router (File-based).
* **Sensors**: `expo-sensors` (Accelerometer) & `expo-location`.
* **Maps**: `react-native-maps` with OSRM & Overpass API integration.

### **Backend (Core Pipeline)**
* **Framework**: FastAPI (Python).
* **AI/NLP**: Google Speech Recognition API.
* **Environment**: Dockerized for seamless deployment.

## 📦 Project Structure

```text
├── backend/
│   ├── main.py              # FastAPI server & NLP logic
│   ├── requirements.txt     # Python dependencies
│   └── Dockerfile           # Container configuration
└── mobile-app/
    ├── app/                 # Main app screens (index, layout, modal)
    ├── assets/              # UI images and logo.jpeg
    ├── components/          # Reusable UI elements (ThemedView, etc.)
    ├── constants/           # Theme colors and global styles
    ├── hooks/               # Custom React hooks
    ├── scripts/             # Utility and maintenance scripts
    ├── package.json         # Node dependencies
    ├── tsconfig.json        # TypeScript configuration
    └── eslint.config.js     # Linting and code quality rules
```

## ⚙️ Setup & Installation

Follow these steps to synchronize the **Sentinel** mobile application with the Python NLP backend.

### **1. Backend (Python/FastAPI)**
The backend manages the AI voice analysis and emergency triggering.

1.  **Navigate to directory**: 
    ```bash
    cd backend
    ```
2.  **Install Dependencies**: Install the required libraries for the FastAPI server and Speech Recognition.
    ```bash
    pip install -r requirements.txt
    ```
3.  **Launch Server**: Start the Sentinel Core Pipeline.
    ```bash
    python main.py
    ```

### **2. Mobile App (Expo/React Native)**
The frontend handles hardware sensors and real-time navigation.

1.  **Navigate to directory**:
    ```bash
    cd mobile-app
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Network Configuration**: Open `index.tsx` and verify the `BACKEND_URL` matches your machine's current local IP address to allow the mobile device to communicate with the server.
    ```javascript
    const BACKEND_URL = 'http://YOUR_LOCAL_IP:8000'; 
    ```
4.  **Start Expo**:
    ```bash
    npx expo start
    ```

### **3. Local Deployment (Docker)**
Alternatively, you can run the backend via the provided Docker container.

1.  **Build Image**:
    ```bash
    docker build -t sentinel-backend .
    ```
2.  **Run Container**:
    ```bash
    docker run -p 8000:8000 sentinel-backend
    ```

## ⚖️ License

This project is licensed under the **MIT License**.

**Copyright (c) 2026**

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, provided that the above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

---

### 🎓 Academic Disclaimer
This project was developed as a technical degree project to solve real-world safety challenges through automation and data intelligence. It is intended for educational and hackathon demonstration purposes.
