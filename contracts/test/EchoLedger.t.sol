// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EchoLedger, IERC165, IReceiver, ReceiverTemplate} from "../src/EchoLedger.sol";

contract RevertingForwarder {
    fallback() external {
        revert("constructor called forwarder");
    }
}

contract EchoLedgerTest is Test {
    EchoLedger private ledger;

    address private constant FORWARDER = address(0xF0);
    address private constant STRANGER = address(0xBAD);
    bytes32 private constant POSITION_ID = keccak256("position-1");
    bytes32 private constant CARD_HASH = keccak256("reasoning-card");
    bytes32 private constant KOL_ID = keccak256("alice-crypto");

    event PositionOpened(bytes32 indexed id, string token, bytes32 indexed cardHash);
    event PositionSettled(bytes32 indexed id, int256 pnlBps);
    event TrustUpdated(bytes32 indexed kolId, uint256 score);

    function setUp() public {
        ledger = new EchoLedger(FORWARDER);
    }

    function test_OnlyForwarderCanCall() public {
        bytes memory report = _openPayload(POSITION_ID, EchoLedger.Attestation.APPROVE);

        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, STRANGER, FORWARDER));
        vm.prank(STRANGER);
        ledger.onReport("", report);
    }

    function test_ConstructorDoesNotCallForwarder() public {
        RevertingForwarder revertingForwarder = new RevertingForwarder();
        EchoLedger deployed = new EchoLedger(address(revertingForwarder));

        assertEq(deployed.forwarder(), address(revertingForwarder));
    }

    function test_OpenReportStoresPositionAndEmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit PositionOpened(POSITION_ID, "ETH", CARD_HASH);
        _send(_openPayload(POSITION_ID, EchoLedger.Attestation.APPROVE));

        EchoLedger.Position memory position = ledger.getPosition(POSITION_ID);
        assertTrue(position.exists);
        assertFalse(position.settled);
        assertEq(position.token, "ETH");
        assertEq(uint256(position.side), uint256(EchoLedger.Side.LONG));
        assertEq(position.sizeBps, 250);
        assertEq(position.entryPriceE8, 3500e8);
        assertEq(position.cardHash, CARD_HASH);
        assertEq(uint256(position.attestation), uint256(EchoLedger.Attestation.APPROVE));
        assertEq(position.reasonCode, 0);

        bytes32[] memory openIds = ledger.openPositionIds();
        assertEq(openIds.length, 1);
        assertEq(openIds[0], POSITION_ID);
    }

    function test_OpenReportStoresRejectWithoutOpeningPosition() public {
        _send(_openPayload(POSITION_ID, EchoLedger.Attestation.REJECT));

        EchoLedger.Position memory position = ledger.getPosition(POSITION_ID);
        assertTrue(position.exists);
        assertEq(uint256(position.attestation), uint256(EchoLedger.Attestation.REJECT));
        assertEq(position.reasonCode, 42);
        assertEq(ledger.openPositionIds().length, 0);
    }

    function test_RejectsDuplicateOpen() public {
        bytes memory report = _openPayload(POSITION_ID, EchoLedger.Attestation.APPROVE);
        _send(report);

        vm.expectRevert(abi.encodeWithSelector(EchoLedger.DuplicatePosition.selector, POSITION_ID));
        _send(report);
    }

    function test_SettleReportUpdatesPositionAndRemovesOpenId() public {
        _send(_openPayload(POSITION_ID, EchoLedger.Attestation.APPROVE));
        EchoLedger.SettleReport memory settlement = EchoLedger.SettleReport({
            positionId: POSITION_ID, exitPriceE8: 3710e8, pnlBps: 600, settledAt: 1_798_000_000
        });

        vm.expectEmit(true, false, false, true);
        emit PositionSettled(POSITION_ID, 600);
        _send(abi.encode(EchoLedger.ReportType.SETTLE, settlement));

        EchoLedger.Position memory position = ledger.getPosition(POSITION_ID);
        assertTrue(position.settled);
        assertEq(position.exitPriceE8, 3710e8);
        assertEq(position.pnlBps, 600);
        assertEq(position.settledAt, 1_798_000_000);
        assertEq(ledger.openPositionIds().length, 0);
    }

    function test_TrustUpdateReportStoresBoundedScoreAndEmitsEvent() public {
        EchoLedger.TrustUpdateReport memory update =
            EchoLedger.TrustUpdateReport({kolId: KOL_ID, score: 8_750, trades: 23});

        vm.expectEmit(true, false, false, true);
        emit TrustUpdated(KOL_ID, 8_750);
        _send(abi.encode(EchoLedger.ReportType.TRUST_UPDATE, update));

        EchoLedger.KolTrust memory trust = ledger.kolTrust(KOL_ID);
        assertEq(trust.score, 8_750);
        assertEq(trust.trades, 23);
    }

    function test_TrustUpdateRejectsScoreAboveMaximum() public {
        EchoLedger.TrustUpdateReport memory update =
            EchoLedger.TrustUpdateReport({kolId: KOL_ID, score: 10_001, trades: 23});

        vm.expectRevert(abi.encodeWithSelector(EchoLedger.InvalidTrustScore.selector, 10_001));
        _send(abi.encode(EchoLedger.ReportType.TRUST_UPDATE, update));
    }

    function test_SupportsReceiverAndERC165Interfaces() public view {
        assertTrue(ledger.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(ledger.supportsInterface(type(IERC165).interfaceId));
        assertFalse(ledger.supportsInterface(0xffffffff));
    }

    function _openPayload(bytes32 positionId, EchoLedger.Attestation attestation) private pure returns (bytes memory) {
        EchoLedger.OpenReport memory report = EchoLedger.OpenReport({
            positionId: positionId,
            token: "ETH",
            side: attestation == EchoLedger.Attestation.REJECT ? EchoLedger.Side.NONE : EchoLedger.Side.LONG,
            sizeBps: attestation == EchoLedger.Attestation.REJECT ? 0 : 250,
            entryPriceE8: 3500e8,
            cardHash: CARD_HASH,
            attestation: attestation,
            reasonCode: attestation == EchoLedger.Attestation.REJECT ? 42 : 0
        });
        return abi.encode(EchoLedger.ReportType.OPEN, report);
    }

    function _send(bytes memory report) private {
        vm.prank(FORWARDER);
        ledger.onReport("", report);
    }
}
