// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Competition} from "../src/Competition.sol";
import {SongRegistry} from "../src/SongRegistry.sol";

/// @notice Adds the three demo songs and opens one competition on each.
/// Values follow SPEC.md.
/// Env:
///   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_SONG_REGISTRY_ADDRESS, NEXT_PUBLIC_COMPETITION_ADDRESS
///   ARTIST_ADDRESS        - demo artist payout wallet (one wallet for all three songs is fine)
///   WINDOW_SECONDS        - competition length (default 900 = 15 min for the demo)
contract Seed is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        SongRegistry registry = SongRegistry(vm.envAddress("NEXT_PUBLIC_SONG_REGISTRY_ADDRESS"));
        Competition competition = Competition(vm.envAddress("NEXT_PUBLIC_COMPETITION_ADDRESS"));
        address artist = vm.envAddress("ARTIST_ADDRESS");
        uint64 window = uint64(vm.envOr("WINDOW_SECONDS", uint256(900)));

        uint16[] memory payout = new uint16[](3);
        payout[0] = 4000; // SPEC.md split: 40 / 20 / 10, artist 25, platform 5
        payout[1] = 2000;
        payout[2] = 1000;

        vm.startBroadcast(pk);
        for (uint256 i = 1; i <= 3; ++i) {
            uint256 songId = registry.addSong(artist, string.concat("/songs/", vm.toString(i), ".json"));
            uint256 id = competition.createCompetition(
                Competition.Config({
                    songId: songId,
                    entryFee: 5e6, // $5 (SPEC.md)
                    closesAt: uint64(block.timestamp) + window,
                    minEntries: 3,
                    maxEntries: 100,
                    artistBps: 2500,
                    platformBps: 500,
                    payoutBps: payout,
                    metric: "YouTube views at close"
                })
            );
            console.log("song %s -> competition %s", songId, id);
        }
        vm.stopBroadcast();
    }
}
