import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Shows the Person 1 flow on a deployed contract: create event, buy ticket,
// add venue, check in once, and prove a second check-in is rejected.
// Run: npx hardhat run scripts/demo.ts --network sepolia

const explorer = (hash: string) =>
  network.name === "sepolia" ? `https://sepolia.etherscan.io/tx/${hash}` : hash;

async function expectRevert(label: string, call: Promise<unknown>) {
  try {
    await call;
    console.log(`  UNEXPECTED: "${label}" did not revert`);
  } catch (e: any) {
    console.log(`  Rejected as expected: "${e.reason ?? e.shortMessage ?? e.message}"`);
  }
}

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run deploy.ts first.`);
  const { address } = JSON.parse(fs.readFileSync(file, "utf8"));

  const [me] = await ethers.getSigners();
  const c = await ethers.getContractAt("TicketNFT", address);
  console.log("Network:", network.name);
  console.log("Contract:", address);
  console.log("Organizer and buyer (same test wallet):", me.address, "\n");

  // 1. Create event
  const latest = await ethers.provider.getBlock("latest");
  const date = BigInt(latest!.timestamp) + 7n * 86400n;
  const face = ethers.parseEther("0.0001");
  let tx = await c.createEvent("FairPass Demo Concert", date, face, 10n, 20, 10);
  await tx.wait();
  const eventId = (await c.nextEventId()) - 1n;
  console.log(`1. createEvent -> eventId ${eventId}\n   ${explorer(tx.hash)}`);

  // 2. Buy ticket
  tx = await c.buyTicket(eventId, "ipfs://demo-placeholder", { value: face });
  const receipt = await tx.wait();
  const minted = receipt!.logs
    .map((l: any) => { try { return c.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "TicketMinted");
  const ticketId = minted!.args.ticketId as bigint;
  console.log(`2. buyTicket -> ticketId ${ticketId}\n   ${explorer(tx.hash)}`);
  console.log(`   Owner of ticket: ${await c.ownerOf(ticketId)}`);
  console.log(`   tokenURI: ${await c.tokenURI(ticketId)}`);

  // 3. Add a venue scanner address
  const venue = ethers.Wallet.createRandom().address;
  tx = await c.addVenue(eventId, venue);
  await tx.wait();
  console.log(`3. addVenue ${venue}\n   ${explorer(tx.hash)}`);
  console.log(`   isVenue: ${await c.isVenue(eventId, venue)}`);

  // 4. A stranger cannot check in (dry run, costs no gas)
  const stranger = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("4. Stranger tries to check in:");
  await expectRevert("stranger check-in", c.connect(stranger).getFunction("checkIn").staticCall(ticketId));

  // 5. Organizer checks the ticket in
  tx = await c.checkIn(ticketId);
  await tx.wait();
  console.log(`5. checkIn ticket ${ticketId}\n   ${explorer(tx.hash)}`);
  console.log(`   used: ${await c.used(ticketId)}`);

  // 6. Second check-in is rejected (dry run, costs no gas)
  console.log("6. Second check-in attempt:");
  await expectRevert("double check-in", c.getFunction("checkIn").staticCall(ticketId));

  // 7. Organizer withdraws the sale proceeds (Person 2's withdraw)
  const pending = await c.pending(me.address);
  tx = await c.withdraw();
  await tx.wait();
  console.log(`7. withdraw ${ethers.formatEther(pending)} ETH of sale proceeds\n   ${explorer(tx.hash)}`);

  console.log("\nDemo complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
