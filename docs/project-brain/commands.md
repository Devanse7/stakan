# Commands

## Install

```bash
npm install
```

## Run Demo

```bash
npm run dev
```

Open the local Vite URL and test with `SIRENUSDT`.

## Type Check

```bash
npm run typecheck
```

## Build Library

```bash
npm run build
```

## Smoke Checklist

1. Start demo
2. Keep symbol as `SIRENUSDT`
3. Confirm header switches from `connecting` to `live`
4. Confirm left cluster zone changes as trades arrive
5. Confirm prints appear between clusters and ladder
6. Confirm ladder shows asks above and bids below
7. Change compression and confirm price step increases while more range becomes visible
