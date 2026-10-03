"""Integration checks for JSON contract discovery and error reporting."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_json import CONTRACT_DIRECTORIES, check_contracts


class ContractIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        for directory in CONTRACT_DIRECTORIES:
            folder = self.root / directory
            folder.mkdir(parents=True)
            (folder / "contract.json").write_text('{"valid": true}', encoding="utf-8")

    def test_all_contract_directories_are_checked(self) -> None:
        self.assertEqual(check_contracts(self.root), len(CONTRACT_DIRECTORIES))

    def test_malformed_coordination_contract_fails(self) -> None:
        (self.root / ".coord/contract.json").write_text("{", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, r"\.coord/contract.json"):
            check_contracts(self.root)

    def test_duplicate_keys_fail(self) -> None:
        (self.root / ".continuity/contract.json").write_text(
            '{"owner": "first", "owner": "second"}', encoding="utf-8"
        )
        with self.assertRaisesRegex(ValueError, "duplicate JSON key: owner"):
            check_contracts(self.root)

    def test_missing_contract_directory_fails(self) -> None:
        (self.root / ".content-system/contract.json").unlink()
        with self.assertRaisesRegex(ValueError, "no JSON contracts in .content-system"):
            check_contracts(self.root)


if __name__ == "__main__":
    unittest.main()
