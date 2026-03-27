import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from 'dotenv';
dotenv.config();

/** @type import('hardhat/config').HardhatUserConfig */
export default {
  solidity: "0.8.20",
  networks: {
    polkadotHubTestnet: {
      url: process.env.POLKADOT_HUB_TESTNET_RPC || "https://eth-rpc-testnet.polkadot.io",
      chainId: 420420417,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  }
};
