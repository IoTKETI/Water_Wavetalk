var SerialPort = require('serialport');
var events = require('events');
var mqtt = require('mqtt');
var util = require('util');
var http = require('http');

global.conf = require('./conf.js');

var wdc = require('./Connector').wdc;
var wdc_base = new wdc();
var event = new events.EventEmitter();
wdc_base.set_wdc_info(conf.cse.host,conf.cse.port,conf.ae.id);

var wavePortNum = 'COM3';
var waveBaudrate = '115200';
global.wavePort = null;
wavePortOpening();

var delay = 5000;

function wavePortOpening() {
    if (wavePort == null) {
        wavePort = new SerialPort(wavePortNum, {
            baudRate: parseInt(waveBaudrate, 10),
        });

        wavePort.on('open', wavePortOpen);
        wavePort.on('close', wavePortClose);
        wavePort.on('error', wavePortError);
        wavePort.on('data', wavePortData);
    } else {
        if (wavePort.isOpen) {

        } else {
            wavePort.open();
        }
    }
}

function wavePortOpen() {
    console.log('wavePort open. ' + wavePortNum + ' Data rate: ' + waveBaudrate);
    interval_upload(delay);
    if (wavePort != null) {
        if (wavePort.isOpen) {
            wavePort.write('\n');
            wavePort.write('3\n');
        }
    }
}

function wavePortClose() {
    console.log('wavePort closed.');

    setTimeout(wavePortOpening, 2000);
}

function wavePortError(error) {
    var error_str = error.toString();
    console.log('[wavePort error]: ' + error.message);
    if (error_str.substring(0, 14) == "Error: Opening") {

    } else {
        console.log('wavePort error : ' + error);
    }

    setTimeout(wavePortOpening, 2000);
}

var str = '';
var value_data ='';
function wavePortData(data) {
    str = data.toString('utf8');
    if(str.length < 70){
        str = str.split('  ');
        
        if(str[1] != undefined){
            value_data = str[1].split(' ');
            value_data = value_data[1]
            console.log(value_data);
          
        }
    }
}

var timerId = '';
function interval_upload(delay){
    var cin_path = conf.ae.parent + '/' + conf.ae.name + '/' + conf.cnt.name+ '/' +'WtqltGnrlMesureIem';//flex_cnt_path
    timerId = setInterval(function(){
      if(value_data !=''){
        var cin_obj = {
            'wat:wqgi':{
            'ntu': value_data
            }
        };
        var resp = wdc_base.flex_create_cnt(cin_path, cin_obj);
        console.log(resp);
      }
  },delay);

}


function init_mqtt_client() {
    var mobius_connectOptions = {
        host: conf.cse.host,
        port: conf.cse.mqttport,
        protocol: "mqtt",
        keepalive: 10,
        protocolId: "MQTT",
        protocolVersion: 4,
        clean: true,
        reconnectPeriod: 2000,
        connectTimeout: 2000,
        rejectUnauthorized: false
    };
    mqtt_client = mqtt.connect(mobius_connectOptions);
    mqtt_client.on('connect', on_mqtt_connect);
    mqtt_client.on('message', on_mqtt_message_recv);
    console.log("init_mqtt_client!!!");
}



function on_mqtt_connect() {
        var noti_topic = util.format('/oneM2M/req/+/%s/#', conf.noti.id);
        mqtt_client.unsubscribe(noti_topic);
        mqtt_client.subscribe(noti_topic);
        console.log('[mqtt_connect] noti_topic : ' + noti_topic);
}

function on_mqtt_message_recv(topic, message) {
    console.log('receive message from topic: <- ' + topic);
    console.log('receive message: ' + message.toString());
    var topic_arr = topic.split("/");
    if (topic_arr[1] == 'oneM2M' && topic_arr[2] == 'req' && topic_arr[4] == conf.noti.id) {
        var jsonObj = JSON.parse(message.toString());
        if (jsonObj['m2m:rqp'] == null) {
            jsonObj['m2m:rqp'] = jsonObj;
        }
        mqtt_noti_action(jsonObj, function (path_arr, cinObj, rqi, sur) {
            if (cinObj) {
                var rsp_topic = '/oneM2M/resp/' + topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5];

                event.emit('upload', sur, cinObj);

                response_mqtt(rsp_topic, '2001', '', conf.ae.id, rqi, '', topic_arr[5]);
            }
        });
    }
    else {
        console.log('topic is not supported');
    }
}


function response_mqtt (rsp_topic, rsc, to, fr, rqi, inpcs) {
    var rsp_message = {};
    rsp_message['m2m:rsp'] = {};
    rsp_message['m2m:rsp'].rsc = rsc;
    rsp_message['m2m:rsp'].to = to;
    rsp_message['m2m:rsp'].fr = fr;
    rsp_message['m2m:rsp'].rqi = rqi;
    rsp_message['m2m:rsp'].pc = inpcs;

    mqtt_client.publish(rsp_topic, JSON.stringify(rsp_message['m2m:rsp']));

    console.log('noti publish -> ' + JSON.stringify(rsp_message));

}



function init_resource(){
        let path = conf.ae.parent + '/' + conf.ae.name+'/'+ conf.cnt.name +'/' + 'config';
        let sub_body = {nu:['mqtt://' + conf.cse.host +'/'+ conf.noti.id + '?ct=json']};
        let sub_obj = {
            'm2m:sub':
                {
                    'rn' : "sub_ipe",
                    'enc': {'net': [1,2,3,4,5]},
                    'nu' : sub_body.nu,
                    'nct': 2,
                    'exc': 0 
                }
        };
        let sub_path = path +'/'+"sub_ipe";
        let resp_sub = wdc_base.retrieve_sub(sub_path);
        if (resp_sub.code == 200) {
            resp_sub = wdc_base.delete_res(sub_path);
            if (resp_sub.code == 200) {
                resp_sub = wdc_base.create_sub(path, sub_obj);
            }
        }
        else if (resp_sub.code == 404) {
            wdc_base.create_sub(path, sub_obj);
        }
        if(resp_sub.code == 201 || resp_sub.code == 409){
           console.log("SUB_Complete!!");
        }
    
    init_mqtt_client();
}

function parse_sgn(rqi, pc, callback) {
    if(pc.sgn) {
        var nmtype = pc['sgn'] != null ? 'short' : 'long';
        var sgnObj = {};
        var cinObj = {};
        sgnObj = pc['sgn'] != null ? pc['sgn'] : pc['singleNotification'];

        if (nmtype === 'long') {
            console.log('oneM2M spec. define only short name for resource')
        }
        else { // 'short'
            if (sgnObj.sur) {
                if(sgnObj.sur.charAt(0) != '/') {
                    sgnObj.sur = '/' + sgnObj.sur;
                }
                var path_arr = sgnObj.sur.split('/');
            }

            if (sgnObj.nev) {
                if (sgnObj.nev.rep) {
                    if (sgnObj.nev.rep['m2m:cin']) {
                        sgnObj.nev.rep.cin = sgnObj.nev.rep['m2m:cin'];
                        delete sgnObj.nev.rep['m2m:cin'];
                    }

                    if (sgnObj.nev.rep.cin) {
                        cinObj = sgnObj.nev.rep.cin;
                    }
                    else {
                        console.log('[mqtt_noti_action] m2m:cin is none');
                        cinObj = null;
                    }
                }
                else {
                    console.log('[mqtt_noti_action] rep tag of m2m:sgn.nev is none. m2m:notification format mismatch with oneM2M spec.');
                    cinObj = null;
                }
            }
            else if (sgnObj.sud) {
                console.log('[mqtt_noti_action] received notification of verification');
                cinObj = {};
                cinObj.sud = sgnObj.sud;
            }
            else if (sgnObj.vrq) {
                console.log('[mqtt_noti_action] received notification of verification');
                cinObj = {};
                cinObj.vrq = sgnObj.vrq;
            }

            else {
                console.log('[mqtt_noti_action] nev tag of m2m:sgn is none. m2m:notification format mismatch with oneM2M spec.');
                cinObj = null;
            }
        }
    }
    else {
        console.log('[mqtt_noti_action] m2m:sgn tag is none. m2m:notification format mismatch with oneM2M spec.');
        console.log(pc);
    }

    callback(path_arr, cinObj, rqi);
};

function mqtt_noti_action(jsonObj, callback) {
    if (jsonObj != null) {
        var op = (jsonObj['m2m:rqp']['op'] == null) ? '' : jsonObj['m2m:rqp']['op'];
        var to = (jsonObj['m2m:rqp']['to'] == null) ? '' : jsonObj['m2m:rqp']['to'];
        var fr = (jsonObj['m2m:rqp']['fr'] == null) ? '' : jsonObj['m2m:rqp']['fr'];
        var rqi = (jsonObj['m2m:rqp']['rqi'] == null) ? '' : jsonObj['m2m:rqp']['rqi'];
        var pc = {};
        pc = (jsonObj['m2m:rqp']['pc'] == null) ? {} : jsonObj['m2m:rqp']['pc'];
        if(pc['m2m:sgn']) {
            pc.sgn = {};
            pc.sgn = pc['m2m:sgn'];
            delete pc['m2m:sgn'];
        }
        parse_sgn(rqi, pc, function(path_arr, cinObj,rqi){
            if(cinObj) {
                if(cinObj.sud || cinObj.vrq) {
                    var resp_topic = '/oneM2M/resp/' + topic_arr[3] + '/' + topic_arr[4] + '/' + topic_arr[5];
                }
                else {
                        console.log('mqtt ' + 'json' + ' notification <----');

                        console.log(cinObj.con["reportingPeriod"]);
                        delay = Number(cinObj.con["reportingPeriod"]+"000");
                        clearInterval(timerId);
                        interval_upload(delay);
                        callback(path_arr, cinObj, rqi, pc.sgn.sur);
                }
            }
        })
    }
    else {
        console.log('[mqtt_noti_action] message is not noti');
    }
}

setTimeout(init_resource,100);