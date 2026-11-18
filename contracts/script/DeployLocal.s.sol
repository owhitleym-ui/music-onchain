// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Competition} from "../src/Competition.sol";
import {SongRegistry} from "../src/SongRegistry.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Local-only: deploys MockUSDC + contracts to anvil, funds anvil's test accounts,
///         and seeds 3 songs with one short competition each.
/// Run: forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployLocal is Script {
    // anvil's default account #0 (public, well-known test key; never use outside localhost)
    uint256 constant ANVIL_PK_0 =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        address deployer = vm.addr(ANVIL_PK_0);
        address artist = address(0xA27157); // dummy artist wallet

        vm.startBroadcast(ANVIL_PK_0);
        MockUSDC usdc = new MockUSDC();
        SongRegistry registry = new SongRegistry(deployer);
        // deployer doubles as oracle and treasury locally
        Competition competition =
            new Competition(IERC20(address(usdc)), registry, deployer, deployer, deployer);

        // $1,000 test USDC to anvil accounts #0-#9 (derived from the default mnemonic)
        string memory mnemonic = "test test test test test test test test test test test junk";
        for (uint32 i = 0; i < 10; ++i) {
            usdc.mint(vm.addr(vm.deriveKey(mnemonic, i)), 1_000e6);
        }

        uint16[] memory payout = new uint16[](3);
        payout[0] = 4000;
        payout[1] = 2000;
        payout[2] = 1000;
        for (uint256 i = 1; i <= 3; ++i) {
            uint256 songId =
                registry.addSong(artist, string.concat("/songs/", vm.toString(i), ".json"));
            competition.createCompetition(
                Competition.Config({
                    songId: songId,
                    entryFee: 5e6, // $5 (SPEC.md)
                    closesAt: uint64(block.timestamp + 15 minutes),
                    minEntries: 3,
                    maxEntries: 100,
                    artistBps: 2500,
                    platformBps: 500,
                    payoutBps: payout,
                    metric: "YouTube views at close"
                })
            );
        }
        vm.stopBroadcast();

        console.log("NEXT_PUBLIC_USDC_ADDRESS=%s", address(usdc));
        console.log("NEXT_PUBLIC_SONG_REGISTRY_ADDRESS=%s", address(registry));
        console.log("NEXT_PUBLIC_COMPETITION_ADDRESS=%s", address(competition));
    }
}
