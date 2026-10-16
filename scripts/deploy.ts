import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const ticket = await ethers.deployContract("TicketNFT");
  await ticket.waitForDeployment();
  const address = await ticket.getAddress();
  console.log("TicketNFT deployed to:", address);

  // The built-in "hardhat" network lives in memory and disappears when the script ends.
  if (network.name === "hardhat") {
    console.log("In-memory network: nothing saved.");
    return;
  }

  // Save the address and ABI for the rest of the team (Persons 3, 4 and 5).
  const artifact = await artifacts.readArtifact("TicketNFT");
  const info = await ethers.provider.getNetwork();
  const output = {
    network: network.name,
    chainId: Number(info.chainId),
    address,
    deployer: deployer.address,
    txHash: ticket.deploymentTransaction()?.hash,
    deployedAt: new Date().toISOString(),
    abi: artifact.abi,
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(output, null, 2));
  console.log(`Saved deployments/${network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
