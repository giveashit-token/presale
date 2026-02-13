/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/giveashit_manager.json`.
 */
export type GiveashitManager = {
  "address": "Count3AcZucFDPSFBAeHkQ6AvttieKUkyJ8HiQGhQwe",
  "metadata": {
    "name": "giveashitManager",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "buyToken",
      "discriminator": [
        138,
        127,
        14,
        91,
        38,
        87,
        115,
        105
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "value",
          "type": "u32"
        }
      ]
    },
    {
      "name": "createToken",
      "discriminator": [
        84,
        52,
        204,
        228,
        24,
        140,
        234,
        75
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "configAccount"
          ]
        },
        {
          "name": "configAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "init",
      "discriminator": [
        220,
        59,
        207,
        236,
        108,
        250,
        47,
        100
      ],
      "accounts": [
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "configAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "dataAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  97,
                  116,
                  97
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "configAccount",
      "discriminator": [
        189,
        255,
        97,
        70,
        186,
        189,
        24,
        102
      ]
    },
    {
      "name": "dataAccount",
      "discriminator": [
        85,
        240,
        182,
        158,
        76,
        7,
        18,
        233
      ]
    }
  ],
  "types": [
    {
      "name": "configAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "configBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "dataAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "aFactor",
            "type": "u8"
          },
          {
            "name": "a",
            "type": "u8"
          },
          {
            "name": "c",
            "type": "u8"
          },
          {
            "name": "cFactor",
            "type": "u8"
          },
          {
            "name": "dataBump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
