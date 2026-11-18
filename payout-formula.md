# Music contest payout formula

Each payout is expressed as a percentage of first place’s payout. First place is 100%.

For rank `r` among `N` ranked entries (`N > 1`), the weights shift evenly across the ranks.

- Linear weight: `w = 0.40 - 0.20 × (r - 1) / (N - 1)`
- Exponential weight: `1 - w`

The first rank uses 40% linear and 60% exponential. The last rank uses 20% linear and 80% exponential. The exponential component halves at each rank.

## Agreed 100-place curve

The linear component runs from 100 at rank 1 to 1 at rank 100. The combined payout, in percent of first place, is

```
w = 0.40 - 0.20 × (r - 1) / 99
payout_percent = w × (101 - r) + (1 - w) × 100 × 0.5^(r - 1)
```

| Rank | Payout relative to first place |
| ---: | ---: |
| 1 | 100.00% |
| 2 | 69.50% |
| 10 | 34.87% |
| 50 | 15.35% |
| 100 | 0.20% |

Table values are rounded to two decimal places.
