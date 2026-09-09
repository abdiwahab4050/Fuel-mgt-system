---
name: Industrial Precision
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45464d'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2a1700'
  on-tertiary-container: '#b87500'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-metrics:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  data-mono:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: -0.01em
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-margin: 32px
  gutter: 20px
  sidebar-width: 280px
  card-padding: 24px
  table-cell-padding: 12px 16px
---

## Brand & Style
The design system is engineered for high-stakes fuel logistics and enterprise resource planning. The personality is **Efficient, Trustworthy, and Technical**, prioritizing rapid data consumption and operational reliability over decorative flair. 

The visual style follows a **Modern Corporate** aesthetic with a lean toward **Minimalism** to manage high data density. It utilizes sharp contrast, a structured grid, and a focus on functional clarity. The emotional response should be one of "command and control"—providing users with a sense of absolute oversight across complex supply chains.

## Colors
The palette is anchored by **Deep Petrol (#0F172A)**, signifying stability and institutional trust. **Action Green (#10B981)** is reserved for positive growth metrics, successful transactions, and "System Ready" states. 

- **Functional Accents**: **Amber (#F59E0B)** is used exclusively for "Low Stock" and "Pending" alerts to drive immediate attention without causing panic. **Red (#EF4444)** is strictly for critical consumption spikes or hardware failures.
- **Neutrals**: A sophisticated range of Slate and Blue-Grays are used to create hierarchy within data tables and sidebar navigation, preventing visual fatigue during long sessions.

## Typography
The system utilizes **Geist** for headlines and technical labels to leverage its precise, geometric structure, which excels in technical environments. **Inter** is used for body copy to ensure maximum legibility in dense forms and multi-row tables.

Numerical data should frequently utilize the `data-mono` style to ensure tabular figures align perfectly, allowing for easier vertical scanning of fuel volumes and currency. `display-metrics` is optimized for high-level dashboard KPIs.

## Layout & Spacing
This design system employs a **Fixed Grid** model for the main content area (max-width: 1600px) to ensure dashboards remain readable on ultra-wide monitors common in logistics hubs.

- **Sidebar**: A fixed 280px left-hand navigation allows for deep nested hierarchies (Fleet, Inventory, Terminals).
- **Density**: A compact 4px base unit is used. To handle high data density, use "comfortable" padding (24px) for metric cards but "compact" padding (12px) for data tables to maximize information above the fold.
- **Breakpoints**: 
  - Desktop: 1280px+ (12 columns)
  - Tablet: 768px - 1279px (8 columns, sidebar collapses to icons)
  - Mobile: <767px (4 columns, vertical stack)

## Elevation & Depth
Depth is achieved through **Tonal Layers** and **Low-contrast Outlines** rather than heavy shadows, maintaining a clean, technical look.

- **Level 0 (Base)**: Background color (#F8FAFC).
- **Level 1 (Cards/Tables)**: White background with a 1px border (#E2E8F0).
- **Level 2 (Dropdowns/Modals)**: White background, 1px border, and a subtle ambient shadow (0px 10px 15px -3px rgba(0,0,0,0.05)) to distinguish overlaying elements.
- **Sidebar**: Uses a dark surface (#0F172A) to provide clear visual separation from the primary work area.

## Shapes
A **Soft (0.25rem)** roundedness level is applied to standard components like input fields, buttons, and badges to provide a modern feel without sacrificing the professional, rigid structure required for enterprise software. Large containers like cards use `rounded-lg` (0.5rem) to soften the overall dashboard layout.

## Components
- **Metric Cards**: Feature a `display-metrics` value, a `label-sm` title, and a small trend sparkline. Success/Danger colors are applied only to the trend percentage text.
- **Data Tables**: Use zebra-striping (Level 0/White) for readability. Headers must be "Sticky" with a slightly thicker bottom border (2px).
- **Status Badges**: Use a "Subtle Pill" style—low-opacity background with high-opacity text of the same hue (e.g., Success Green background at 10% opacity with 100% opacity text).
- **Buttons**:
  - *Primary*: Solid #0F172A with white text.
  - *Success*: Solid #10B981 for "Confirm Order" or "Release Fuel."
  - *Ghost*: Transparent background with #64748B text for secondary actions.
- **Sidebar Navigation**: Active states use a "Left-accent" border (4px Action Green) and a subtle background highlight to clearly indicate user location.
- **Input Fields**: Default state uses a 1px Slate-200 border; Focus state uses a 2px Deep Petrol border with no outer glow.