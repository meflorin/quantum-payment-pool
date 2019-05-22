import Sequelize from 'sequelize';

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false,
    pool: {
        max: 5,
        min: 0,
        idle: 10000
    },
});

export const SessionTx = sequelize.define('session_tx', {
        session_id: {
            type: Sequelize.STRING,
            primaryKey: true
        },
        from_address: {
            type: Sequelize.STRING,
            primaryKey: true
        },
        to_address: {
            type: Sequelize.STRING
        },
        value: {
            type: Sequelize.BIGINT(20)
        },
        signature: {
            type: Sequelize.STRING
        },
        commited: {
            type: Sequelize.INTEGER
        },
        tx_hash: {
            type: Sequelize.STRING
        },
        pending: {
            type: Sequelize.INTEGER
        },
        receipt: {
            type: Sequelize.TEXT
        },
    },
    {
        underscored: true,
        freezeTableName: true
    }
);

export const WithdrawTx = sequelize.define('withdraw_tx', {
    to_address: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
    },
    signature: {
        type: Sequelize.STRING,
        allowNull: false
    },       
    tx_hash: {
        type: Sequelize.STRING
    },
    receipt: {
        type: Sequelize.TEXT
    },
    commited: {
        type: Sequelize.INTEGER,
        defaultValue: 0
    },
    pending: {
        type: Sequelize.INTEGER,
        defaultValue: 0
    },
    cooldown_expire: {
        type: Sequelize.DataTypes.DATE(),
        allowNull: false,        
    },
    by_user: {
        type: Sequelize.INTEGER,
        defaultValue: 0
    },
    retries: {
        type: Sequelize.INTEGER,
        defaultValue: 0
    },
    },{
    underscored: true,
    freezeTableName: true,
});

sequelize.sync({
    logging : true,
    //force : true
});
//sequelize.sync();