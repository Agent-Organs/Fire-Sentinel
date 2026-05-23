# Fire-Sentinel
Smart security system using Moore machine FSM with multi-sensor pattern detection for fire and intrusion alerts. Automata theory in practice.
# Fire Sentinel - Smart Security System

An intelligent security monitoring system built on Moore machine finite state automaton principles, featuring advanced pattern detection capabilities for comprehensive threat analysis.

## Overview

Fire Sentinel is a theoretical smart security system that demonstrates how automata theory can be applied to real-world IoT security applications. Unlike traditional alarm systems that react to isolated events, Fire Sentinel analyzes sequences of sensor inputs to identify different threat patterns and generate appropriate security responses.

## Features

- **Multi-Sensor Integration**: Combines data from multiple sensor types for comprehensive monitoring
- **Pattern Detection**: Identifies specific event sequences to distinguish between different security scenarios
- **State-Based Architecture**: Uses Moore machine design for predictable and reliable state transitions
- **Intelligent Alert System**: Generates context-aware alerts based on detected patterns
- **Scalable Design**: Easily extensible to incorporate additional sensors and threat patterns

## System Components

### Sensors
1. **Motion Detector (M)**: Detects movement in monitored areas
2. **Temperature Sensor (T)**: Monitors for abnormal temperature spikes
3. **Door/Window Sensors (D)**: Tracks entry point status
4. **Glass Break Detector (G)**: Identifies potential forced entry

### Detected Patterns

| Pattern            | Sequence       | Interpretation                              |
|--------------------|----------------|---------------------------------------------|
| Unauthorized Entry | M → D → M      | Motion before and after door opening        |
| Fire + Intrusion   | T → G → M      | Temperature spike, glass break, then motion |
| Fire Emergency     | T → T → T      | Sustained high temperature                  |
| Forced Entry       | G → M → D      | Glass break followed by entry               |

## 🏗️ Architecture

Fire Sentinel implements a **Moore machine** where:
- **States** represent different security conditions
- **Inputs** are sensor readings (binary: triggered/not triggered)
- **Outputs** are security alerts determined solely by the current state
- **Transitions** occur based on input combinations

### State Diagram

The system uses a finite state automaton with multiple states to track sensor input sequences and generate appropriate alerts. See the state diagram image in the repository for visual representation.

## 🚀 Use Cases

- **Residential Security**: Home intrusion detection with fire safety
- **Commercial Buildings**: Office and warehouse monitoring
- **Industrial Facilities**: Combined fire and security monitoring
- **Educational Purposes**: Demonstrating automata theory in practical applications

## 📊 Technical Specifications

- **State Machine Type**: Moore Machine
- **Input Alphabet**: {M, T, D, G} (sensor triggers)
- **Output Alphabet**: {No Alert, Intrusion Alert, Fire Alert, Critical Alert}
- **Transition Logic**: Deterministic finite automaton (DFA)

## Academic Context

This project was developed as part of coursework in **Cyber Physical Systems**, demonstrating:
- Practical application of finite state machines
- Integration of theoretical computer science with IoT systems
- Pattern recognition using state-based logic
- Real-world problem solving with formal methods

## Implementation Notes

The current version is a **theoretical design and state diagram**. Potential implementation approaches:
- **Embedded Systems**: Arduino, Raspberry Pi with sensor modules
- **Software Simulation**: Python, Java, or C++ state machine implementation
- **Hardware Description**: Verilog/VHDL for FPGA deployment

## 📈 Future Enhancements

- [ ] Machine learning integration for adaptive pattern recognition
- [ ] Mobile app for remote monitoring and alerts
- [ ] Cloud connectivity for data logging and analytics
- [ ] Additional sensor types (smoke, CO2, camera integration)
- [ ] Customizable alert thresholds and pattern definitions
- [ ] Historical data analysis and threat prediction

## Documentation

- State transition diagram (SVG/PNG)
- Sensor input specifications
- Alert generation logic
- Pattern detection algorithms

## Contributing

This is an academic project, but suggestions and improvements are welcome! Feel free to:
- Suggest additional threat patterns
- Propose alternative state machine designs
- Share implementation experiences
- Report issues or inconsistencies

## Author

**Pushkar Reddy T**  
Electronics and Computer Engineering Student

---

**Note**: This is a theoretical design project demonstrating automata theory concepts. For production security systems, consult with security professionals and follow industry standards.
