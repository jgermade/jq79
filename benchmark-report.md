# jq79 benchmark report

- **generated** 2026-08-24T10:15:10.559Z
- **runner** Intel(R) Xeon(R) Processor @ 2.10GHz × 4 · node v22.22.2 · chromium 141.0.7390.37
- **method** 3 alternating rounds × 10 samples per operation, medians, after 1 discarded warm-up round
- **base** 4942c2f, cloneSkeletons off `4942c2f55114`
- **head** 4942c2f, cloneSkeletons on `4942c2f55114`

| operation | base | head | delta | per round | noise | verdict |
|---|---:|---:|---:|---|---:|---|
| Create 1,000 rows | 43.4ms | 33.3ms | -23.3% | -24.1% / -22.8% / -23.3% | ±7.3% | faster, every round |
| Replace all 1,000 rows | 50.6ms | 38.8ms | -20.7% | -17.3% / -26.3% / -20.7% | ±9.4% | faster, every round |
| Update every 10th row | 1.8ms | 1.6ms | 0.0% | -15.4% / 0.0% / 0.0% | ±17.1% | inside the noise |
| Select a row | 4.6ms | 4.3ms | -8.7% | -1.2% / -10.2% / -8.7% | ±13.0% | faster every round, under the noise |
| Swap rows | 6.9ms | 6.3ms | -3.9% | -3.9% / -9.3% / -3.6% | ±8.7% | faster every round, under the noise |
| Remove a row | 5.5ms | 5.6ms | +1.8% | +3.7% / +1.8% / +0.9% | ±3.6% | slower every round, under the noise |
| Create 10,000 rows | 421.1ms | 353.8ms | -12.4% | -9.5% / -12.4% / -20.0% | ±10.2% | faster, every round |
| Append 1,000 rows to 10,000 | 77.5ms | 70.8ms | -15.3% | -15.3% / -20.7% / -4.8% | ±16.1% | faster every round, under the noise |
| Clear 10,000 rows | 130.9ms | 117.1ms | -10.6% | -3.8% / -10.6% / -32.9% | ±36.5% | faster every round, under the noise |

**delta** is the median of the **per round** deltas beside it - each of those is one base/head pair measured minutes apart on this machine, which is the only thing a shared runner controls for. It is not the difference of the two medians, which compares measurements taken under different conditions.

**noise** is how far this operation moved between rounds of the same build - the runner's own spread.
A delta smaller than it says nothing about size. **"every round"** means the 3 rounds also agreed on the sign - supporting evidence, not proof: 3 coin flips land the same way 25.0% of the time. More rounds is the only thing that shrinks both columns.

<details><summary>raw json</summary>

```json
{
  "generatedAt": "2026-08-24T10:15:10.559Z",
  "runner": {
    "cpu": "Intel(R) Xeon(R) Processor @ 2.10GHz × 4",
    "node": "v22.22.2",
    "chromium": "141.0.7390.37",
    "ci": null
  },
  "samples": 10,
  "rounds": 3,
  "warmupRounds": 1,
  "gate": null,
  "builds": [
    {
      "id": "base",
      "label": "4942c2f, cloneSkeletons off",
      "ref": "4942c2f55114cd8c599e03600fe1f7f3f3f7b40a"
    },
    {
      "id": "head",
      "label": "4942c2f, cloneSkeletons on",
      "ref": "4942c2f55114cd8c599e03600fe1f7f3f3f7b40a"
    }
  ],
  "operations": [
    {
      "id": "create1k",
      "label": "Create 1,000 rows",
      "rounds": {
        "base": [
          46.2,
          43.05,
          43.35
        ],
        "head": [
          35.05,
          33.25,
          33.25
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 43.35,
        "head": 33.25
      },
      "noise": 7.3,
      "deltaPerRound": [
        -24.1,
        -22.8,
        -23.3
      ],
      "delta": -23.3,
      "deltaOfMedians": -23.3,
      "headFasterInRounds": 3,
      "verdict": "faster, every round"
    },
    {
      "id": "replace1k",
      "label": "Replace all 1,000 rows",
      "rounds": {
        "base": [
          50.65,
          52.55,
          48.25
        ],
        "head": [
          41.9,
          38.75,
          38.25
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 50.65,
        "head": 38.75
      },
      "noise": 9.4,
      "deltaPerRound": [
        -17.3,
        -26.3,
        -20.7
      ],
      "delta": -20.7,
      "deltaOfMedians": -23.5,
      "headFasterInRounds": 3,
      "verdict": "faster, every round"
    },
    {
      "id": "partialUpdate",
      "label": "Update every 10th row",
      "rounds": {
        "base": [
          1.95,
          1.75,
          1.65
        ],
        "head": [
          1.65,
          1.75,
          1.65
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 1.75,
        "head": 1.65
      },
      "noise": 17.1,
      "deltaPerRound": [
        -15.4,
        0,
        0
      ],
      "delta": 0,
      "deltaOfMedians": -5.7,
      "headFasterInRounds": 1,
      "verdict": "inside the noise"
    },
    {
      "id": "selectRow",
      "label": "Select a row",
      "rounds": {
        "base": [
          4.3,
          4.9,
          4.6
        ],
        "head": [
          4.25,
          4.4,
          4.2
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 4.6,
        "head": 4.25
      },
      "noise": 13,
      "deltaPerRound": [
        -1.2,
        -10.2,
        -8.7
      ],
      "delta": -8.7,
      "deltaOfMedians": -7.6,
      "headFasterInRounds": 3,
      "verdict": "faster every round, under the noise"
    },
    {
      "id": "swapRows",
      "label": "Swap rows",
      "rounds": {
        "base": [
          6.4,
          7,
          6.9
        ],
        "head": [
          6.15,
          6.35,
          6.65
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 6.9,
        "head": 6.35
      },
      "noise": 8.7,
      "deltaPerRound": [
        -3.9,
        -9.3,
        -3.6
      ],
      "delta": -3.9,
      "deltaOfMedians": -8,
      "headFasterInRounds": 3,
      "verdict": "faster every round, under the noise"
    },
    {
      "id": "removeRow",
      "label": "Remove a row",
      "rounds": {
        "base": [
          5.4,
          5.6,
          5.55
        ],
        "head": [
          5.6,
          5.7,
          5.6
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 5.55,
        "head": 5.6
      },
      "noise": 3.6,
      "deltaPerRound": [
        3.7,
        1.8,
        0.9
      ],
      "delta": 1.8,
      "deltaOfMedians": 0.9,
      "headFasterInRounds": 0,
      "verdict": "slower every round, under the noise"
    },
    {
      "id": "create10k",
      "label": "Create 10,000 rows",
      "rounds": {
        "base": [
          390.8,
          425.95,
          421.15
        ],
        "head": [
          353.8,
          373.15,
          337.05
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 421.15,
        "head": 353.8
      },
      "noise": 10.2,
      "deltaPerRound": [
        -9.5,
        -12.4,
        -20
      ],
      "delta": -12.4,
      "deltaOfMedians": -16,
      "headFasterInRounds": 3,
      "verdict": "faster, every round"
    },
    {
      "id": "appendToLarge",
      "label": "Append 1,000 rows to 10,000",
      "rounds": {
        "base": [
          76.8,
          89.3,
          77.5
        ],
        "head": [
          65.05,
          70.85,
          73.8
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 77.5,
        "head": 70.85
      },
      "noise": 16.1,
      "deltaPerRound": [
        -15.3,
        -20.7,
        -4.8
      ],
      "delta": -15.3,
      "deltaOfMedians": -8.6,
      "headFasterInRounds": 3,
      "verdict": "faster every round, under the noise"
    },
    {
      "id": "clearLarge",
      "label": "Clear 10,000 rows",
      "rounds": {
        "base": [
          123.5,
          130.95,
          171.35
        ],
        "head": [
          118.8,
          117.1,
          115.05
        ]
      },
      "roundsMeasured": 3,
      "median": {
        "base": 130.95,
        "head": 117.1
      },
      "noise": 36.5,
      "deltaPerRound": [
        -3.8,
        -10.6,
        -32.9
      ],
      "delta": -10.6,
      "deltaOfMedians": -10.6,
      "headFasterInRounds": 3,
      "verdict": "faster every round, under the noise"
    }
  ],
  "regressions": []
}
```

</details>
