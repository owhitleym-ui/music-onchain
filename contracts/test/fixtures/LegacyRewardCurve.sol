// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UD60x18, ud} from "@prb/math/src/UD60x18.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice The saved 100-position reward curve, sampled across N logical spots.
/// @dev All results and coordinates use 18-decimal fixed point; divisions round down.
library LegacyRewardCurve {
    uint256 internal constant WAD = 1e18;
    error InvalidRank();

    function ratioWad(uint256 rank, uint256 spots) internal pure returns (uint256) {
        if (rank == 0 || spots == 0 || rank > spots) revert InvalidRank();
        uint256 x = WAD + Math.mulDiv(rank - 1, 100 * WAD, spots);
        if (x > 100 * WAD) x = 100 * WAD;
        uint256 z = x - WAD;
        uint256 weight = 0.4e18 - Math.mulDiv(0.2e18, z, 99 * WAD);
        uint256 linear = (101 * WAD - x) / 100;
        uint256 exponential;
        // Integer powers are exact, including the original 100-place examples.
        if (z % WAD == 0) {
            exponential = WAD >> (z / WAD);
        } else {
            UD60x18 power = ud(2 * WAD).pow(ud(z));
            exponential = Math.mulDiv(WAD, WAD, power.unwrap());
        }
        uint256 ratio = Math.mulDiv(weight, linear, WAD)
            + Math.mulDiv(WAD - weight, exponential, WAD);
        return Math.min(ratio, WAD);
    }
}
