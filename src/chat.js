/**
 * Copyright 2012 Adrenaline Mobility.  All rights reserved.
 *
 * See the AUTHORS and LICENSE files for additional information on
 * contributors and the software license agreement.
 */

exportUrl = null;

CHAT_NAME_KEY = ".chat.name";
CHAT_SESSIONS_METADATA_KEY = ".chat.sessions_metadata";
CHAT_PUSH_URL = ".chat.pushurl";

PUSH_ACTIVE = "active";
PUSH_INACTIVE = "inactive";
PUSH_DISABLED = "disabled";

// session metadata includes
//  - appendId
//  - mtime
//  - participants
//  - pushState (active, inactive, disabled)

_chatPushUrl = null;
function getPushUrl() {
    return _chatPushUrl;
}

function Chat() {
    if(arguments.callee._singletonInstance)
        return arguments.callee._singletonInstance;
    arguments.callee._singletonInstance = this;

    this._sessionList = [];
    var pushUrl = localStorage.getItem(CHAT_PUSH_URL);
    if(!pushUrl) {
        var that = this;
        dopamine.webPush.requestPushUrl(function(url) {
            if(url) {
                that._pushUrl = url;
                localStorage.setItem(CHAT_PUSH_URL, url);
                for(var idx = 0; idx < that._sessionList.length; idx++) {
                    var appendId = that._sessionList[idx].appendId();
                    dopamine.appendStore.addPushUrl(appendId, url);
                }
            }
        });
    } else {
        this._pushUrl = pushUrl;
    }
    _chatPushUrl = pushUrl;

    var sessionData = localStorage.getItem(CHAT_SESSIONS_METADATA_KEY);
    if(sessionData) {
        sessionData = JSON.parse(sessionData);

        for(var idx = 0; idx < sessionData.length; idx++) {
            this._sessionList.push(new Session(sessionData[idx]));
        }
    }

    this._userName = localStorage.getItem(CHAT_NAME_KEY);
    this._currentSession = null;
    this._pushUrl = null;
    this._hasPendingFlush = false;
}

Chat.prototype.hasName = function() {
    return this._userName !== null;
};

Chat.prototype.name = function() {
    return this._userName;
};

Chat.prototype.setName = function(name) {
    localStorage.setItem(CHAT_NAME_KEY, name);
    return this._userName = name;
};

Chat.prototype.clearCurrentSession = function() {
    this._currentSession = null;
};

Chat.prototype.importCurrentSession = function(appendId) {
    this._currentSession = new Session();
    this._currentSession.setAppendId(appendId);
    this.addSession(this._currentSession);
};

Chat.prototype.setSessionById = function(appendId) {
    for(var idx = 0; idx < this._sessionList.length; idx++) {
        if(this._sessionList[idx].appendId() === appendId) {
            this.setCurrentSession(idx);
            return true;
        }
    }
    
    return false;
};

Chat.prototype.setCurrentSession = function(sessionIdx) {
    this._currentSession = this._sessionList[sessionIdx];
    this._currentSession.setActive();
};

Chat.prototype.getCurrentSession = function() {
    if(this._currentSession === null) {
        this._currentSession = new Session();
        this.addSession(this._currentSession);
    }

    return this._currentSession;
};

Chat.prototype.hasCurrentSession = function() {
    return this._currentSession !== null;
};

Chat.prototype.addSession = function(session) {
    this._sessionList.push(session);
    this.flushMetaData();
};

Chat.prototype.flushMetaData = function() {
    // XXX FIXME consistency between in memory data and on disk...
    if(this._hasPendingFlush)
        return;

    this._hasPendingFlush = true;
    var that = this;
    setTimeout(function() {
        var sessionData = [];
        for(var idx = 0; idx < that._sessionList.length; idx++) {
            sessionData.push(that._sessionList[idx].getMetaData());
        }

        localStorage.setItem(CHAT_SESSIONS_METADATA_KEY,
                             JSON.stringify(sessionData));
        that._hasPendingFlush = false;
    }, 100);
}

Chat.prototype.sessions = function() {
    // XXX FIXME sort this...
    return this._sessionList;
};

function Session(metaData) {    
    if(metaData) {
        this._id = metaData.appendId;
        this._participants = metaData.participants;
        this._mtime = metaData.mtime;
        this._startIdx = metaData.startIdx;
        this._pushState = metaData.pushState;
    } else {
        this._id = dopamine.utils.getNewId();
        this._participants = [];
        this._mtime = new Date();
        this._startIdx = 0;
        this._pushState = PUSH_INACTIVE;
    }

    var pushUrl = getPushUrl();
    if(pushUrl) {
        dopamine.appendStore.addPushUrl(this._id, pushUrl);
    }

    var messages = localStorage.getItem("messages:" + this._id);
    if(messages) {
        this._messages = JSON.parse(messages);
    } else {
        this._messages = [];
    }
}

Session.prototype.getMetaData = function() {
    return {appendId: this._id,
            mtime: this._mtime,
            participants: this._participants,
            startIdx: this._startIdx,
            pushState: this._pushState};
};

Session.prototype.appendId = function() {
    return this._id;
};

Session.prototype.setAppendId = function(id) {
    this._id = id;
};

Session.prototype.setActive = function() {
    var message, sender;
    for (var idx = 0; idx < this._messages.length; idx++) {
        message = this._messages[idx];
        sender = message.isMine ? "Me" : message.sender;
        appendMessage(message.message, sender,
                      timeInPast(message.ctime),
                      !message.isMine);
    }
};

Session.prototype.setStartIdx = function(startIdx) {
    this._startIdx = startIdx;
    chat.flushMetaData();
};

Session.prototype.startIdx = function() {
    return this._startIdx;
};

Session.prototype._addParticipant = function(name) {
    for(var idx = 0; idx < this._participants.length; idx++) {
        if(this._participants[idx] === name) {
            return;
        }
    }

    this._participants.push(name);
    var names = getParticipantsString(this._participants);
    $("#chat-title").text(name);
    chat.flushMetaData();
};

Session.prototype.newMessage = function(message) {
    var div = $("[data-mine=true]").first();
    var isMine = false;
    if(div !== null) {
        if((chat.name() === message.sender) &&
           (message.message === div.find(".message-div-text").text())) {
            div.attr("data-mine", "done");
            div.find(".message-ctime").text(timeInPast(message.ctime));
            isMine = true;
        } else {
            appendMessage(message.message, message.sender,
                          timeInPast(message.ctime), true);
            this._addParticipant(message.sender);
        }
    }

    message.isMine = isMine;
    // XXX FIXME we need to do something to ensure that the in memory
    // copy of _messages is consistent with on disk version
    this._messages.push(message);
    localStorage.setItem("messages:" + this._id,
                         JSON.stringify(this._messages));
};

Session.prototype.sendMessage = function(msg) {
    var ctime = new Date();
    var sender = chat.name();

    var actionUrl = window.location.protocol + "//" + window.location.host +
        "/apps/chat/chat.html#chat-page?objId=" +
        chat.getCurrentSession().appendId();

    dopamine.appendStore.append(this._id, [{message: msg,
                                            sender: sender,
                                            ctime: ctime}],
                                null, null, actionUrl, sender + " says...",
                                msg, getPushUrl());
};

Session.prototype.messages = function() {
    return this._messages;
};

Session.prototype.participants = function() {
    // XXX FIXME sort the participants list
    return this._participants;
};

Session.prototype.updateMtime = function() {
    this._mtime = new Date();
    chat.flushMetaData();
};

function timeInPast(isoTime) {
    var past = new Date(isoTime);
    var curr = new Date();

    if((past.getFullYear() === curr.getFullYear()) &&
       (past.getMonth() === curr.getMonth()) &&
       (past.getDate() === curr.getDate())) {
        var hour = past.getHours();
        var min = past.getMinutes();
        var ampm = "am";
        if(hour > 12) {
            ampm = "pm";
            hour = hour - 12;
        }
        if(hour === 0) {
            hour = 12;
        }
        if(min < 10) {
            min = "0" + min;
        }
        return hour + ":" + min + ampm;
    } else if (past.getFullYear() === curr.getFullYear()) {
        return (past.getMonth()+1) + "/" + past.getDate();
    }

    return (past.getMonth()+1) + "/" + past.getDate() + "/" + past.getFullYear();
}

chat = new Chat();

function appendMessage(msg, sender, ctime, isFriend) {
    var mine = "done";

    if(typeof(isFriend) === 'undefined') {
        isFriend = false;
    }

    var pict = "message-pict-me";
    if(isFriend) {
        pict = "message-pict-friend0";
        mine = "false";
    } else if(typeof(ctime) === 'undefined') {
        // undefined ctime means new message
        ctime = "Sending...";
        mine = "true";
    }

    var html = 
        '<div class="message-div" data-mine="' + mine + '">' +
        '  <div class="message-pict-bg"><div class="' + pict + '"></div></div>' +
        '  <div class="message-sender">' + sender + '</div>' +
        '  <div class="message-ctime">' + ctime + '</div>' +
        '  <span class="message-div-text">' + msg + '</span>' +
        '</div>';
    
    $(html).appendTo("#chat-messages");
    scrollToBottom();
}

function postInputText() {
    var msg = $("#message-text").val();
    if(msg === "")
        return;

    appendMessage(msg, "Me");
    $("#message-text").val("");
    chat.getCurrentSession().updateMtime();
    chat.getCurrentSession().sendMessage(msg);
}

function scrollToBottom() {
    var div = $("#chat-messages");
    if(div.prop("scrollHeight") >= 0) {
        div.scrollTop(div.prop("scrollHeight"));
    }
}

function exportInit() {
    $("#export-url-page").on("pageshow", function() {
        if(exportUrl) {
            // XXX FIXME adjust the size based on size of exportUrl
            var qr = qrcode(9, 'M');        
            qr.addData(exportUrl);
            qr.make();
            var img = qr.createImgTag(3, 0);
            $("#qr-div").html(img);
        } else {
            window.location.href = "#";
        }
    });
}

function parseQueryString(key) {
    // XXX FIXME this is obviously broken with multiple keys
    var query = "?" + key + "=";
    var queryIdx = window.location.hash.indexOf(query);

    if(queryIdx >= 0) {
        return window.location.hash.substring(queryIdx + query.length);
    }

    return null;
}

function chatPageInit() {
    $("#chat-page").on("pageshow", function() {
        var importId = parseQueryString("objId");
        if(importId) {
            $("#chat-messages").html("");

            if(!chat.setSessionById(importId)) {
                chat.importCurrentSession(importId);
            }
        }

        var sessionIdx = parseQueryString("sessionIdx");
        if(sessionIdx !== null) {
            $("#chat-messages").html("");
            chat.setCurrentSession(sessionIdx);
        }

        if(!chat.hasName()) {
            window.location.href = "#set-name-page";
            return;
        }

        if(!chat.hasCurrentSession()) {
            $("#chat-messages").html("");
            $("#chat-title").text("New chat");
        } else {
            // not visible yet...
            setTimeout(scrollToBottom, 0);
            var participants = chat.getCurrentSession().participants();
            $("#chat-title").text(getParticipantsString(participants));
        }
    });

    dopamine.ui.tapclick.enable($("#invite-qr"));
    $("#invite-qr").on("tapclick", function(event) {
        exportUrl = window.location.protocol + "//" + window.location.host +
            "/apps/chat/chat.html#chat-page?objId=" +
            chat.getCurrentSession().appendId();
        window.location.href = "#export-url-page";
    });

    /*
     * This doesn't work with iOS for some reason
     *
     * dopamine.ui.tapclick.enable($("#chat-arrow"), true);
     * $("#chat-arrow").on("tapclick", function(event) {
     *     $("#message-text").focus();
     *     event.preventDefault();
     *     postInputText();
     * });
     */

    $("#chat-arrow").on("click", function(event) {
        $("#message-text").focus();
        event.preventDefault();
        postInputText();
    });

    $(window).resize(function() {
        if($("#chat-page").hasClass('active-page')) {
            scrollToBottom();
        }
    });

    $("#message-text").focus(function() {
        scrollToBottom();
    });
}

function setNamePageInit() {
    $("#set-name-page").on("pageshow", function() {
        if(chat.hasName()) {
            $("#your-name").val(chat.name());
        } else {
            $("#your-name").val("");
        }
    });

    $("#set-name-btn").on("tapclick", function() {
        var name = $("#your-name").val();
        if(name !== "") {
            chat.setName(name);
        }
    });
}

_sessionsListUi = null;

function getParticipantsString(participants) {
    var names = "";
    if(participants.length === 0) {
        names = "No participants";
    } else if (participants.length === 1) {
        names = participants[0];
    } else if (participants.length === 2) {
        names = participants[0] + " and " +
            participants[1];
    } else {
        for(var idx = 0; idx < participants.length; idx++) {
            names = participants[idx] + ", ";
        }
        // XXX FIXME trim off the last comma
    }

    return names;
}

function sessionsPageInit() {
    _sessionsListUi = new BasicList("#sessions-content");
    $("#sessions-page").on("pageshow", function() {
        chat.clearCurrentSession();
        _sessionsListUi.remove();
        var sessions = chat.sessions();
        var names;
        var session;
        for(var idx = 0; idx < sessions.length; idx++) {            
            session = sessions[idx];
            names = getParticipantsString(session.participants());
            var item = _sessionsListUi.append(names, "#chat-page?sessionIdx=" + idx);
            dopamine.ui.tapclick.enable(item);
        }
    });
}

function startPolling() {
    if(chat.hasCurrentSession()) {
        var session = chat.getCurrentSession();
        var objId = session.appendId();
        dopamine.appendStore.get(objId, session.startIdx(), function(ret) {
            if(ret["return"] === "ok") {
                session.setStartIdx(ret.start_index + ret.values.length);
                if(chat.hasCurrentSession() &&
                   chat.getCurrentSession().appendId() === session.appendId()) {
                    for(var idx = 0; idx < ret.values.length; idx++) {
                        session.newMessage(ret.values[idx]);
                    }
                }
            }
        });
        
    }

    setTimeout(function(){startPolling();}, 2000);
}

$(document).ready(function() {
    sessionsPageInit();
    chatPageInit(); 
    setNamePageInit();
    exportInit();

    startPolling();
});
